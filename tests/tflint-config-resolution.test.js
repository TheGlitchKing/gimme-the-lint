'use strict';

// Regression tests: tflint config resolution is root-aware and consistent.
// In the standard Terraform monorepo (one repo-root .tflint.hcl, many nested
// units) the adapter must lint every unit WITH that config — pass --config,
// run --init against it — and configHashFor() must hash the very same file.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const TflintAdapter = require('../lib/adapters/tflint');
const { configHashFor } = require('../lib/baseline');
const manifestManager = require('../lib/manifest-manager');

function tflintInstalled() {
  try {
    const r = spawnSync('tflint', ['--version'], { encoding: 'utf8' });
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
}
const TFLINT = tflintInstalled();

// --- monorepo: one repo-root .tflint.hcl, nested units with none of their own
describe('tflint root-config resolution (monorepo)', () => {
  const ROOT = path.join(os.tmpdir(), `gimme-tfcfg-${Date.now()}`);
  const rootConfig = path.join(ROOT, '.tflint.hcl');

  before(async () => {
    await fs.ensureDir(ROOT);
    await fs.writeFile(
      rootConfig,
      [
        'plugin "terraform" {',
        '  enabled = true',
        '}',
        'plugin "foo" {',
        '  enabled = true',
        '}',
        'rule "terraform_required_version" {',
        '  enabled = false',
        '}',
      ].join('\n') + '\n'
    );
    // Nested units, each WITHOUT its own .tflint.hcl.
    for (const unit of ['modules/a', 'envs/dev']) {
      await fs.ensureDir(path.join(ROOT, unit));
      await fs.writeFile(
        path.join(ROOT, unit, 'main.tf'),
        'resource "null_resource" "x" {}\n'
      );
    }
    // A unit WITH its own .tflint.hcl — nearest-wins.
    await fs.ensureDir(path.join(ROOT, 'standalone'));
    await fs.writeFile(
      path.join(ROOT, 'standalone', '.tflint.hcl'),
      'plugin "terraform" {\n  enabled = true\n}\n'
    );
    await fs.writeFile(
      path.join(ROOT, 'standalone', 'main.tf'),
      'resource "null_resource" "y" {}\n'
    );
  });
  after(async () => {
    await fs.remove(ROOT);
  });

  it('buildCommand for a nested unit passes --config=<absolute root path>', () => {
    const unitDir = path.join(ROOT, 'modules', 'a');
    const tf = new TflintAdapter({ projectRoot: ROOT, appRoot: unitDir });
    const cmd = tf.buildCommand(['modules/a'], {});
    assert.strictEqual(cmd.cwd, unitDir, 'runs in the unit dir');
    assert.ok(
      cmd.args.includes(`--config=${rootConfig}`),
      `expected --config=${rootConfig} in ${JSON.stringify(cmd.args)}`
    );
  });

  it('initCommand for a nested unit points --init at the root config', () => {
    const unitDir = path.join(ROOT, 'envs', 'dev');
    const tf = new TflintAdapter({ projectRoot: ROOT, appRoot: unitDir });
    const init = tf.initCommand(unitDir);
    assert.ok(init, 'a config exists, so --init is returned');
    assert.ok(init.args.includes('--init'));
    assert.ok(init.args.includes(`--config=${rootConfig}`));
  });

  it('configHashFor and the adapter resolve to the SAME file for every unit', async () => {
    for (const unit of ['modules/a', 'envs/dev']) {
      const unitDir = path.join(ROOT, unit);
      const tf = new TflintAdapter({ projectRoot: ROOT, appRoot: unitDir });
      assert.strictEqual(
        tf.resolveConfigPath(unitDir),
        rootConfig,
        `${unit}: adapter resolves the root config`
      );
      const hash = await configHashFor(ROOT, unitDir, tf);
      assert.strictEqual(
        hash,
        await manifestManager.hashFile(rootConfig),
        `${unit}: configHashFor hashes the root config`
      );
    }
  });

  it('_declaredPlugins reads the root config from a nested unit', () => {
    const unitDir = path.join(ROOT, 'modules', 'a');
    const tf = new TflintAdapter({ projectRoot: ROOT, appRoot: unitDir });
    assert.deepStrictEqual(tf._declaredPlugins(unitDir).sort(), ['foo', 'terraform']);
  });

  it('a unit with its own .tflint.hcl uses its own (nearest-wins)', () => {
    const unitDir = path.join(ROOT, 'standalone');
    const tf = new TflintAdapter({ projectRoot: ROOT, appRoot: unitDir });
    assert.strictEqual(
      tf.resolveConfigPath(unitDir),
      path.join(unitDir, '.tflint.hcl'),
      'the unit-local config wins over the repo-root one'
    );
    assert.ok(
      tf.buildCommand(['standalone'], {}).args.includes(
        `--config=${path.join(unitDir, '.tflint.hcl')}`
      )
    );
  });

  it(
    'end-to-end: a root rule { enabled = false } suppresses it for a nested unit',
    { skip: TFLINT ? false : 'tflint not installed' },
    () => {
      // The "foo" plugin block is bogus; use a clean config for the real run.
      const e2e = path.join(ROOT, 'e2e');
      fs.ensureDirSync(path.join(e2e, 'envs', 'dev'));
      fs.writeFileSync(
        path.join(e2e, '.tflint.hcl'),
        'plugin "terraform" {\n  enabled = true\n}\n' +
          'rule "terraform_required_version" {\n  enabled = false\n}\n'
      );
      fs.writeFileSync(
        path.join(e2e, 'envs', 'dev', 'main.tf'),
        'resource "null_resource" "x" {}\n'
      );
      const tf = new TflintAdapter({
        projectRoot: e2e,
        appRoot: path.join(e2e, 'envs', 'dev'),
      });
      const violations = tf.lint(['envs/dev'], {});
      assert.ok(
        !violations.some((v) => v.ruleId === 'terraform_required_version'),
        'the rule disabled in the root config does not fire for the nested unit'
      );
    }
  );
});

// --- no .tflint.hcl anywhere → zero-config core ruleset path
describe('tflint with no config anywhere', () => {
  const ROOT = path.join(os.tmpdir(), `gimme-tfnocfg-${Date.now()}`);

  before(async () => {
    await fs.ensureDir(path.join(ROOT, 'infra'));
    await fs.writeFile(
      path.join(ROOT, 'infra', 'main.tf'),
      'resource "null_resource" "x" {}\n'
    );
  });
  after(async () => {
    await fs.remove(ROOT);
  });

  it('buildCommand adds no --config and initCommand returns null', () => {
    const unitDir = path.join(ROOT, 'infra');
    const tf = new TflintAdapter({ projectRoot: ROOT, appRoot: unitDir });
    assert.strictEqual(tf.resolveConfigPath(unitDir), null);
    assert.ok(!tf.buildCommand(['infra'], {}).args.some((a) => a.startsWith('--config')));
    assert.strictEqual(tf.initCommand(unitDir), null);
  });
});
