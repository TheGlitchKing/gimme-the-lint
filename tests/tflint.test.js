'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const adapters = require('../lib/adapters');
const TflintAdapter = require('../lib/adapters/tflint');
const projectModel = require('../lib/project-model');
const { resolveUnits } = require('../lib/units');

const TMP = path.join(os.tmpdir(), `gimme-test-tflint-${Date.now()}`);

describe('tflint registry', () => {
  it('registers the tflint adapter', () => {
    assert.ok(adapters.listAdapters().includes('tflint'));
    assert.strictEqual(adapters.hasAdapter('tflint'), true);
  });

  it('constructs the adapter by id', () => {
    assert.ok(adapters.getAdapter('tflint') instanceof TflintAdapter);
  });

  it('maps Terraform to the tflint adapter by language', () => {
    assert.deepStrictEqual(
      adapters.adaptersForLanguage('terraform').map((a) => a.id),
      ['tflint']
    );
  });

  it('exposes the expected identity', () => {
    const tf = new TflintAdapter();
    assert.strictEqual(tf.id, 'tflint');
    assert.deepStrictEqual(tf.languages, ['terraform']);
    assert.strictEqual(tf.supportsFix, true);
    assert.deepStrictEqual(tf.sourceExtensions, ['.tf', '.tofu']);
  });
});

describe('TflintAdapter.parse', () => {
  const tf = new TflintAdapter({ projectRoot: '/proj' });

  it('parses the {issues:[...]} report shape into NormalizedViolations', () => {
    const json = JSON.stringify({
      issues: [
        {
          rule: { name: 'terraform_unused_declarations', severity: 'warning' },
          message: '`region` variable is declared but not used',
          range: {
            filename: 'variables.tf',
            start: { line: 3, column: 1 },
            end: { line: 3, column: 20 },
          },
        },
        {
          rule: { name: 'terraform_required_version', severity: 'error' },
          message: 'terraform "required_version" attribute is required',
          range: {
            filename: 'main.tf',
            start: { line: 1, column: 1 },
          },
        },
      ],
      errors: [],
    });
    const violations = tf.parse(json);
    assert.strictEqual(violations.length, 2);
    assert.strictEqual(violations[0].file, 'variables.tf');
    assert.strictEqual(violations[0].ruleId, 'terraform_unused_declarations');
    assert.strictEqual(violations[0].line, 3);
    assert.strictEqual(violations[0].severity, 'warning');
    assert.strictEqual(violations[0].source, 'tflint');
    assert.strictEqual(violations[1].severity, 'error');
  });

  it('surfaces tflint config/parse errors as blocking errors', () => {
    const json = JSON.stringify({
      issues: [],
      errors: [
        {
          message: 'Failed to parse main.tf: Argument or block definition required',
          severity: 'error',
          range: { filename: 'main.tf', start: { line: 7, column: 3 } },
        },
      ],
    });
    const violations = tf.parse(json);
    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].ruleId, 'tflint-error');
    assert.strictEqual(violations[0].severity, 'error');
    assert.strictEqual(violations[0].file, 'main.tf');
    assert.strictEqual(violations[0].line, 7);
  });

  it('maps notice severity to info', () => {
    const json = JSON.stringify({
      issues: [
        {
          rule: { name: 'terraform_comment_syntax', severity: 'notice' },
          message: 'Single line comments should begin with #',
          range: { filename: 'main.tf', start: { line: 2, column: 1 } },
        },
      ],
    });
    assert.strictEqual(tf.parse(json)[0].severity, 'info');
  });

  it('returns [] for empty or non-JSON output', () => {
    assert.deepStrictEqual(tf.parse(''), []);
    assert.deepStrictEqual(tf.parse('not json'), []);
    assert.deepStrictEqual(tf.parse(JSON.stringify({ issues: [], errors: [] })), []);
  });
});

describe('TflintAdapter.buildCommand', () => {
  it('requests JSON output and adds --fix only when asked', () => {
    const tf = new TflintAdapter({ projectRoot: '/proj' });
    const plain = tf.buildCommand([], {});
    assert.ok(plain.args.includes('--format=json'));
    assert.ok(!plain.args.includes('--fix'));
    const fixed = tf.buildCommand([], { fix: true });
    assert.ok(fixed.args.includes('--fix'));
  });

  it('runs in the target directory (module-scoped)', async () => {
    await fs.ensureDir(path.join(TMP, 'infra'));
    const tf = new TflintAdapter({ projectRoot: TMP });
    const cmd = tf.buildCommand(['infra'], {});
    assert.strictEqual(cmd.cwd, path.join(TMP, 'infra'));
  });
});

describe('TflintAdapter detection', () => {
  before(async () => {
    await fs.ensureDir(path.join(TMP, 'tf-app'));
    await fs.writeFile(path.join(TMP, 'tf-app', 'main.tf'), 'resource "x" "y" {}\n');
    await fs.ensureDir(path.join(TMP, 'tofu-app'));
    await fs.writeFile(path.join(TMP, 'tofu-app', 'main.tofu'), 'resource "x" "y" {}\n');
    await fs.ensureDir(path.join(TMP, 'js-app'));
    await fs.writeFile(path.join(TMP, 'js-app', 'package.json'), '{}');
  });

  after(async () => {
    await fs.remove(TMP);
  });

  it('detects directories containing .tf and .tofu files', () => {
    assert.strictEqual(new TflintAdapter().detect(path.join(TMP, 'tf-app')), true);
    assert.strictEqual(new TflintAdapter().detect(path.join(TMP, 'tofu-app')), true);
  });

  it('does not detect a non-Terraform directory', () => {
    assert.strictEqual(new TflintAdapter().detect(path.join(TMP, 'js-app')), false);
  });

  it('discoverApps binds a Terraform directory to tflint', () => {
    const apps = projectModel.discoverApps(TMP);
    const byPath = Object.fromEntries(apps.map((a) => [a.appPath, a.linters]));
    assert.deepStrictEqual(byPath['tf-app'], ['tflint']);
    assert.deepStrictEqual(byPath['tofu-app'], ['tflint']);
  });

  it('resolveUnits turns a Terraform app into a lint unit', () => {
    const units = resolveUnits(TMP);
    const infra = units.find((u) => u.appPath === 'tf-app');
    assert.ok(infra);
    assert.deepStrictEqual(infra.linters, ['tflint']);
  });
});
