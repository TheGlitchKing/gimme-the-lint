'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const adapters = require('../lib/adapters');
const AnsibleLintAdapter = require('../lib/adapters/ansible');
const projectModel = require('../lib/project-model');
const { resolveUnits } = require('../lib/units');
const linterConfigs = require('../lib/linter-configs');

const TMP = path.join(os.tmpdir(), `gimme-test-ansible-${Date.now()}`);

describe('ansible-lint registry', () => {
  it('registers the ansible-lint adapter', () => {
    assert.ok(adapters.listAdapters().includes('ansible-lint'));
    assert.strictEqual(adapters.hasAdapter('ansible-lint'), true);
  });

  it('constructs the adapter by id', () => {
    assert.ok(adapters.getAdapter('ansible-lint') instanceof AnsibleLintAdapter);
  });

  it('maps Ansible to the ansible-lint adapter by language', () => {
    assert.deepStrictEqual(
      adapters.adaptersForLanguage('ansible').map((a) => a.id),
      ['ansible-lint']
    );
  });

  it('exposes the expected identity', () => {
    const a = new AnsibleLintAdapter();
    assert.strictEqual(a.id, 'ansible-lint');
    assert.deepStrictEqual(a.languages, ['ansible']);
    assert.strictEqual(a.supportsFix, true);
    // Detection is manifest-only — no YAML extension scan.
    assert.deepStrictEqual(a.sourceExtensions, []);
    assert.deepStrictEqual(a.manifestFiles, ['ansible.cfg', 'galaxy.yml']);
  });
});

describe('AnsibleLintAdapter.parse', () => {
  const a = new AnsibleLintAdapter({ projectRoot: '/proj' });

  it('parses the CodeClimate JSON report into NormalizedViolations', () => {
    const json = JSON.stringify([
      {
        type: 'issue',
        check_name: 'name[play]',
        description: 'All plays should be named.',
        severity: 'major',
        location: { path: 'site.yml', lines: { begin: 1 } },
      },
      {
        type: 'issue',
        check_name: 'yaml[line-length]',
        description: 'Line too long',
        severity: 'minor',
        location: { path: 'roles/web/tasks/main.yml', positions: { begin: { line: 12, column: 5 } } },
      },
    ]);
    const violations = a.parse(json);
    assert.strictEqual(violations.length, 2);
    assert.strictEqual(violations[0].file, 'site.yml');
    assert.strictEqual(violations[0].ruleId, 'name[play]');
    assert.strictEqual(violations[0].line, 1);
    assert.strictEqual(violations[0].severity, 'error');
    assert.strictEqual(violations[0].source, 'ansible-lint');
    assert.strictEqual(violations[1].file, 'roles/web/tasks/main.yml');
    assert.strictEqual(violations[1].line, 12);
    assert.strictEqual(violations[1].col, 5);
    assert.strictEqual(violations[1].severity, 'warning');
  });

  it('maps info severity to info', () => {
    const json = JSON.stringify([
      { check_name: 'meta-no-info', description: 'x', severity: 'info', location: { path: 'a.yml', lines: { begin: 2 } } },
    ]);
    assert.strictEqual(a.parse(json)[0].severity, 'info');
  });

  it('returns [] for empty or non-JSON output', () => {
    assert.deepStrictEqual(a.parse(''), []);
    assert.deepStrictEqual(a.parse('not json'), []);
    assert.deepStrictEqual(a.parse('{}'), []);
  });
});

describe('AnsibleLintAdapter.buildCommand', () => {
  it('requests CodeClimate output and adds --fix only when asked', () => {
    const a = new AnsibleLintAdapter({ projectRoot: '/proj' });
    const plain = a.buildCommand([], {});
    assert.ok(plain.args.includes('-f') && plain.args.includes('codeclimate'));
    assert.ok(!plain.args.includes('--fix'));
    assert.ok(plain.args.includes('.'), 'defaults to scanning the project');
    const fixed = a.buildCommand(['site.yml'], { fix: true });
    assert.ok(fixed.args.includes('--fix'));
    assert.ok(fixed.args.includes('site.yml'));
  });
});

describe('AnsibleLintAdapter detection', () => {
  before(async () => {
    await fs.ensureDir(path.join(TMP, 'infra-cfg'));
    await fs.writeFile(path.join(TMP, 'infra-cfg', 'ansible.cfg'), '[defaults]\n');
    await fs.ensureDir(path.join(TMP, 'collection'));
    await fs.writeFile(path.join(TMP, 'collection', 'galaxy.yml'), 'namespace: acme\n');
    // A plain-YAML directory must NOT be detected as Ansible.
    await fs.ensureDir(path.join(TMP, 'just-yaml'));
    await fs.writeFile(path.join(TMP, 'just-yaml', 'config.yaml'), 'key: value\n');
  });

  after(async () => {
    await fs.remove(TMP);
  });

  it('detects directories with ansible.cfg or galaxy.yml', () => {
    assert.strictEqual(new AnsibleLintAdapter().detect(path.join(TMP, 'infra-cfg')), true);
    assert.strictEqual(new AnsibleLintAdapter().detect(path.join(TMP, 'collection')), true);
  });

  it('does not detect a plain-YAML directory', () => {
    assert.strictEqual(new AnsibleLintAdapter().detect(path.join(TMP, 'just-yaml')), false);
  });

  it('discoverApps binds an Ansible directory to ansible-lint', () => {
    const apps = projectModel.discoverApps(TMP);
    const byPath = Object.fromEntries(apps.map((a) => [a.appPath, a.linters]));
    assert.deepStrictEqual(byPath['infra-cfg'], ['ansible-lint']);
    assert.deepStrictEqual(byPath['collection'], ['ansible-lint']);
    assert.ok(!byPath['just-yaml'], 'plain YAML is not an Ansible app');
  });

  it('resolveUnits turns an Ansible app into a lint unit', () => {
    const units = resolveUnits(TMP);
    const cfg = units.find((u) => u.appPath === 'infra-cfg');
    assert.ok(cfg);
    assert.deepStrictEqual(cfg.linters, ['ansible-lint']);
  });

  it('install seeds a .ansible-lint config into an Ansible app', async () => {
    const written = await linterConfigs.writeLinterConfigs(TMP);
    const seeded = written.find((w) => w.app === 'infra-cfg' && w.linter === 'ansible-lint');
    assert.ok(seeded);
    assert.strictEqual(seeded.status, 'created');
    assert.ok(await fs.pathExists(path.join(TMP, 'infra-cfg', '.ansible-lint')));
  });
});
