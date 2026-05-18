'use strict';

// Regression tests for the v2.3.0 tflint-integration audit (Phase 1 / HIGH):
//   Task 1 — tflint silent-failure on uninitialized ruleset plugins
//   Task 2 — generic ruleset-plugin version tracking + ruleset drift
//   Task 3 — eslint false-positive on a tooling-only package.json
//   Task 4 — available() agreeing with lint() when plugins are declared
//   Tasks 6/8 — explicit version(), manifestFiles cleanup

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const adapters = require('../lib/adapters');
const { LinterAdapter } = require('../lib/adapters/adapter');
const TflintAdapter = require('../lib/adapters/tflint');
const EslintAdapter = require('../lib/adapters/eslint');
const projectModel = require('../lib/project-model');
const baselineStore = require('../lib/baseline-store');
const { runBaseline } = require('../lib/baseline');
const { detectDrift } = require('../lib/drift');

// A version-output string covering the bundled ruleset and an opt-in one.
const VERSION_TEXT = [
  'TFLint version 0.52.0',
  '+ ruleset.terraform (0.7.0, bundled)',
  '+ ruleset.foo (0.30.1)',
].join('\n');

// Stub that feeds canned `tflint --version` output — no real binary needed.
class StubTflint extends TflintAdapter {
  constructor(opts, versionText) {
    super(opts);
    this._stub = versionText;
  }
  _probe() {
    return { error: null, status: 0, stdout: this._stub, stderr: '' };
  }
  _versionOutput() {
    return this._stub;
  }
  _ensureInitialized() {
    /* no real init in tests */
  }
}

// ===========================================================================
// Task 1 — tflint parse: a failed run is loud, never a clean baseline
// ===========================================================================
describe('Task 1 — tflint failed runs are not silent clean baselines', () => {
  const tf = new TflintAdapter({ projectRoot: '/proj' });

  it('a non-zero exit with no JSON yields a tflint-error violation', () => {
    const v = tf.parse('', 'Plugin `foo` not installed; run `tflint --init`', 1);
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].ruleId, 'tflint-error');
    assert.strictEqual(v[0].severity, 'error');
    assert.match(v[0].message, /tflint --init/);
  });

  it('a clean exit with no output is an empty (genuinely clean) result', () => {
    assert.deepStrictEqual(tf.parse('', '', 0), []);
  });

  it('valid JSON still parses issues regardless of exit code', () => {
    const json = JSON.stringify({
      issues: [
        {
          rule: { name: 'terraform_unused_declarations', severity: 'warning' },
          message: 'unused',
          range: { filename: 'main.tf', start: { line: 2, column: 1 } },
        },
      ],
      errors: [],
    });
    const v = tf.parse(json, '', 2);
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].ruleId, 'terraform_unused_declarations');
  });
});

// ===========================================================================
// Task 1/4 — init + declared-plugin introspection (generic, no provider names)
// ===========================================================================
describe('Task 1/4 — .tflint.hcl introspection drives init & availability', () => {
  const TMP = path.join(os.tmpdir(), `gimme-tfg-init-${Date.now()}`);

  before(async () => {
    // A module WITH a .tflint.hcl declaring two plugins.
    await fs.ensureDir(path.join(TMP, 'with-cfg'));
    await fs.writeFile(path.join(TMP, 'with-cfg', 'main.tf'), 'resource "x" "y" {}\n');
    await fs.writeFile(
      path.join(TMP, 'with-cfg', '.tflint.hcl'),
      'plugin "terraform" {\n  enabled = true\n}\nplugin "foo" {\n  enabled = true\n  version = ">= 0.20"\n}\n'
    );
    // A core-only module with NO .tflint.hcl.
    await fs.ensureDir(path.join(TMP, 'core-only'));
    await fs.writeFile(path.join(TMP, 'core-only', 'main.tf'), 'resource "x" "y" {}\n');
  });
  after(async () => {
    await fs.remove(TMP);
  });

  it('initCommand returns `tflint --init` only when a .tflint.hcl is present', () => {
    const tf = new TflintAdapter({ projectRoot: TMP });
    const withCfg = tf.initCommand(path.join(TMP, 'with-cfg'));
    assert.ok(withCfg && withCfg.args.includes('--init'));
    assert.strictEqual(tf.initCommand(path.join(TMP, 'core-only')), null);
  });

  it('_declaredPlugins enumerates plugin blocks generically (no provider lookup)', () => {
    const tf = new TflintAdapter({ projectRoot: TMP });
    assert.deepStrictEqual(
      tf._declaredPlugins(path.join(TMP, 'with-cfg')).sort(),
      ['foo', 'terraform']
    );
    assert.deepStrictEqual(tf._declaredPlugins(path.join(TMP, 'core-only')), []);
  });

  it('available() is true for a core-only module (declares no plugins)', () => {
    const tf = new StubTflint({ projectRoot: TMP, appRoot: path.join(TMP, 'core-only') }, VERSION_TEXT);
    assert.strictEqual(tf.available(), true);
  });

  it('available() reflects whether declared plugins resolve', () => {
    // VERSION_TEXT has ruleset.foo → declared "foo" resolves.
    const ok = new StubTflint({ projectRoot: TMP, appRoot: path.join(TMP, 'with-cfg') }, VERSION_TEXT);
    assert.strictEqual(ok.available(), true);
    // A version output WITHOUT ruleset.foo → declared "foo" is unresolved.
    const missing = new StubTflint(
      { projectRoot: TMP, appRoot: path.join(TMP, 'with-cfg') },
      'TFLint version 0.52.0\n+ ruleset.terraform (0.7.0, bundled)'
    );
    assert.strictEqual(missing.available(), false);
  });
});

// ===========================================================================
// Task 2 — generic ruleset-plugin version tracking
// ===========================================================================
describe('Task 2/6 — rulesetVersions() and explicit version()', () => {
  it('rulesetVersions() returns a generic { name: version } map', () => {
    const tf = new StubTflint({ projectRoot: '/p' }, VERSION_TEXT);
    assert.deepStrictEqual(tf.rulesetVersions(), {
      terraform: '0.7.0',
      foo: '0.30.1',
    });
  });

  it('version() parses the TFLint version line deliberately', () => {
    const tf = new StubTflint({ projectRoot: '/p' }, VERSION_TEXT);
    assert.strictEqual(tf.version(), '0.52.0');
  });

  it('manifestFiles no longer lists .terraform.lock.hcl', () => {
    const tf = new TflintAdapter({ projectRoot: '/p' });
    assert.deepStrictEqual(tf.manifestFiles, ['.tflint.hcl']);
  });

  it('createLinterSection persists ruleset_versions only when supplied', () => {
    const withRs = baselineStore.createLinterSection([], {
      rulesetVersions: { terraform: '0.7.0' },
    });
    assert.deepStrictEqual(withRs.ruleset_versions, { terraform: '0.7.0' });
    const without = baselineStore.createLinterSection([], {});
    assert.ok(!('ruleset_versions' in without));
  });
});

// ===========================================================================
// Task 2 — ruleset drift: a plugin version change is detected
// ===========================================================================
const fakeTf = { rulesets: { terraform: '0.7.0' } };

class FakeTfAdapter extends LinterAdapter {
  get id() {
    return 'faketf';
  }
  get languages() {
    return ['faketf'];
  }
  get sourceExtensions() {
    return ['.ftf'];
  }
  detect() {
    return true;
  }
  available() {
    return true;
  }
  version() {
    return '1.0.0';
  }
  configFiles() {
    return [];
  }
  lint() {
    return [];
  }
  rulesetVersions() {
    return { ...fakeTf.rulesets };
  }
}

describe('Task 2 — ruleset-plugin drift detection', () => {
  const TMP = path.join(os.tmpdir(), `gimme-tfg-drift-${Date.now()}`);

  before(async () => {
    adapters.registerAdapter('faketf', FakeTfAdapter);
    await fs.ensureDir(TMP);
    await fs.writeFile(
      path.join(TMP, 'gimme-the-lint.config.js'),
      "module.exports = { apps: { '.': { linters: ['faketf'] } } };\n"
    );
    await fs.writeFile(path.join(TMP, 'main.ftf'), 'x\n');
  });
  after(async () => {
    await fs.remove(TMP);
  });

  it('no ruleset drift right after baselining', async () => {
    fakeTf.rulesets = { terraform: '0.7.0' };
    await runBaseline(TMP);
    const drift = await detectDrift(TMP);
    assert.ok(!drift.linterDrift.some((d) => d.type === 'ruleset'));
  });

  it('detects a ruleset plugin version change with no config-file change', async () => {
    fakeTf.rulesets = { terraform: '0.7.0' };
    await runBaseline(TMP);
    // A loose version constraint pulled a newer ruleset — config text unchanged.
    fakeTf.rulesets = { terraform: '0.8.0' };
    const drift = await detectDrift(TMP);
    const rs = drift.linterDrift.find((d) => d.type === 'ruleset');
    assert.ok(rs, 'a ruleset drift entry is emitted');
    assert.strictEqual(rs.ruleset, 'terraform');
    assert.strictEqual(rs.from, '0.7.0');
    assert.strictEqual(rs.to, '0.8.0');
  });
});

// ===========================================================================
// Task 3 — eslint false-positive on a tooling-only package.json
// ===========================================================================
describe('Task 3 — tooling-only package.json is not an eslint app', () => {
  const TMP = path.join(os.tmpdir(), `gimme-tfg-pkg-${Date.now()}`);

  before(async () => {
    await fs.ensureDir(TMP);
    // A devDependencies-only, private, source-free tooling manifest.
    await fs.ensureDir(path.join(TMP, 'tooling'));
    await fs.writeFile(
      path.join(TMP, 'tooling', 'package.json'),
      '{"name":"tooling","private":true,"devDependencies":{"prettier":"^3"}}'
    );
    // A real JS app — has runtime dependencies AND source.
    await fs.ensureDir(path.join(TMP, 'realapp'));
    await fs.writeFile(
      path.join(TMP, 'realapp', 'package.json'),
      '{"name":"realapp","dependencies":{"react":"^18"}}'
    );
    await fs.writeFile(path.join(TMP, 'realapp', 'index.js'), 'export const x = 1;\n');
  });
  after(async () => {
    await fs.remove(TMP);
  });

  it('discovery does NOT bind eslint to a tooling-only package.json', () => {
    const apps = projectModel.discoverApps(TMP);
    const byPath = Object.fromEntries(apps.map((a) => [a.appPath, a.linters]));
    assert.ok(!('tooling' in byPath), 'tooling dir is not an eslint app');
    assert.deepStrictEqual(byPath['realapp'], ['eslint'], 'real app still bound');
  });

  it('EslintAdapter.detect() requires a config or real JS/TS source', () => {
    const e = new EslintAdapter();
    // Bare tooling package.json — not enough.
    assert.strictEqual(e.detect(path.join(TMP, 'tooling')), false);
    // A directory with JS source — detected.
    assert.strictEqual(e.detect(path.join(TMP, 'realapp')), true);
  });

  it('an ESLint config alone makes a directory detectable', async () => {
    const dir = path.join(TMP, 'configured');
    await fs.ensureDir(dir);
    await fs.writeFile(path.join(dir, 'eslint.config.js'), 'export default [];\n');
    assert.strictEqual(new EslintAdapter().detect(dir), true);
  });
});
