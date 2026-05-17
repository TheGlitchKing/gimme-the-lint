'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const projectModel = require('../lib/project-model');
const { resolveUnits } = require('../lib/units');

const TMP = path.join(os.tmpdir(), `gimme-test-pm-${Date.now()}`);

async function makeManifest(dir, file, content = '{}') {
  await fs.ensureDir(path.join(TMP, dir));
  await fs.writeFile(path.join(TMP, dir, file), content);
}

describe('project-model', () => {
  describe('globToRegExp', () => {
    it('matches simple glob patterns', () => {
      assert.ok(projectModel.globToRegExp('_template-*').test('_template-svc'));
      assert.ok(projectModel.globToRegExp('*.template.*').test('foo.template.js'));
      assert.ok(!projectModel.globToRegExp('_template-*').test('orders-api'));
    });
  });

  describe('discoverApps — polyglot monorepo', () => {
    before(async () => {
      await fs.ensureDir(TMP);
      await makeManifest('apps/orders-api', 'package.json');
      await makeManifest('apps/orders-worker', 'pyproject.toml', '[project]\n');
      await makeManifest('apps/billing-events', 'go.mod', 'module billing\n');
      await makeManifest('apps/audit-stream', 'Cargo.toml', '[package]\n');
      // A template directory that must be skipped.
      await makeManifest('apps/_template-svc', 'package.json');
    });

    after(async () => {
      await fs.remove(TMP);
    });

    it('discovers one app per package, with the right linters', () => {
      const apps = projectModel.discoverApps(TMP);
      const byPath = Object.fromEntries(apps.map((a) => [a.appPath, a.linters]));
      assert.deepStrictEqual(byPath['apps/orders-api'], ['eslint']);
      assert.deepStrictEqual(byPath['apps/orders-worker'], ['ruff']);
      assert.deepStrictEqual(byPath['apps/billing-events'], ['golangci-lint']);
      assert.deepStrictEqual(byPath['apps/audit-stream'], ['clippy']);
    });

    it('skips template directories by convention', () => {
      const apps = projectModel.discoverApps(TMP);
      assert.ok(!apps.some((a) => a.appPath.includes('_template')));
    });

    it('resolveUnits turns discovered apps into lint units', () => {
      const units = resolveUnits(TMP);
      assert.strictEqual(units.length, 4);
      const billing = units.find((u) => u.appPath === 'apps/billing-events');
      assert.deepStrictEqual(billing.linters, ['golangci-lint']);
      assert.ok(billing.baselinePath.endsWith(
        path.join('.gtl', 'apps', 'apps/billing-events', 'baseline.json')
      ));
    });
  });

  describe('discoverApps — workspace root', () => {
    const WS = path.join(os.tmpdir(), `gimme-test-ws-${Date.now()}`);
    before(async () => {
      // Root package.json (the workspace) + one real package beneath it.
      await fs.ensureDir(WS);
      await fs.writeFile(path.join(WS, 'package.json'), '{"workspaces":["packages/*"]}');
      await fs.ensureDir(path.join(WS, 'packages', 'web'));
      await fs.writeFile(path.join(WS, 'packages', 'web', 'package.json'), '{}');
    });
    after(async () => {
      await fs.remove(WS);
    });

    it('treats the manifest root with nested packages as a workspace, not an app', () => {
      const apps = projectModel.discoverApps(WS);
      assert.deepStrictEqual(apps.map((a) => a.appPath), ['packages/web']);
    });
  });

  describe('discoverApps — single package', () => {
    const SP = path.join(os.tmpdir(), `gimme-test-sp-${Date.now()}`);
    before(async () => {
      await fs.ensureDir(SP);
      await fs.writeFile(path.join(SP, 'pyproject.toml'), '[project]\n');
    });
    after(async () => {
      await fs.remove(SP);
    });

    it('treats a lone manifest at the root as the app', () => {
      const apps = projectModel.discoverApps(SP);
      assert.deepStrictEqual(apps, [{ appPath: '.', linters: ['ruff'] }]);
    });
  });

  describe('discoverApps — empty project', () => {
    const EMPTY = path.join(os.tmpdir(), `gimme-test-empty-${Date.now()}`);
    before(async () => {
      await fs.ensureDir(EMPTY);
    });
    after(async () => {
      await fs.remove(EMPTY);
    });

    it('returns no apps', () => {
      assert.deepStrictEqual(projectModel.discoverApps(EMPTY), []);
    });
  });
});
