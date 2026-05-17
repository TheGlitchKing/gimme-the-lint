'use strict';

// Regression tests for the three bugs found running v1→v2 `migrate` against a
// real polyglot monorepo:
//   Bug A — Node adapters resolved their binary only at the repo root, so
//           app-local ESLint/Biome was missed and the linter silently skipped.
//   Bug B — manifest discovery bound bare `requirements.txt` dirs and dropped
//           a repo-root config that governs a conventional source tree.
//   Bug C — "couldn't run" was collapsed into "skipped", so an incomplete
//           baseline looked identical to a clean one.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const adapters = require('../lib/adapters');
const { LinterAdapter } = require('../lib/adapters/adapter');
const EslintAdapter = require('../lib/adapters/eslint');
const BiomeAdapter = require('../lib/adapters/biome');
const projectModel = require('../lib/project-model');
const configManager = require('../lib/config-manager');
const baselineStore = require('../lib/baseline-store');
const { runBaseline, findIncompleteBaselines } = require('../lib/baseline');
const { runCheck } = require('../lib/check');
const { createViolation } = require('../lib/violation');

// ===========================================================================
// Bug A — monorepo binary resolution
// ===========================================================================
describe('Bug A — Node adapters resolve the binary from the app dir', () => {
  const TMP = path.join(os.tmpdir(), `gimme-bugA-${Date.now()}`);

  before(async () => {
    await fs.ensureDir(TMP);
  });
  after(async () => {
    await fs.remove(TMP);
  });

  it('ESLint resolves an app-local binary the repo root does not have', async () => {
    const appDir = path.join(TMP, 'frontend');
    await fs.ensureFile(path.join(appDir, 'node_modules', '.bin', 'eslint'));

    const appAware = new EslintAdapter({ projectRoot: TMP, appRoot: appDir });
    assert.strictEqual(
      appAware.binary,
      path.join(appDir, 'node_modules', '.bin', 'eslint'),
      'app-aware adapter finds frontend/node_modules/.bin/eslint'
    );

    // The old projectRoot-only behavior would miss it entirely.
    const rootOnly = new EslintAdapter({ projectRoot: TMP });
    assert.strictEqual(rootOnly.binary, 'eslint', 'root-only falls through to PATH');
  });

  it('Biome resolves an app-local binary too', async () => {
    const appDir = path.join(TMP, 'keycloakify');
    await fs.ensureFile(path.join(appDir, 'node_modules', '.bin', 'biome'));
    const a = new BiomeAdapter({ projectRoot: TMP, appRoot: appDir });
    assert.strictEqual(a.binary, path.join(appDir, 'node_modules', '.bin', 'biome'));
  });

  it('buildCommand runs inside the app dir so the app config is discovered', () => {
    const appDir = path.join(TMP, 'frontend');
    const a = new EslintAdapter({ projectRoot: TMP, appRoot: appDir });
    const cmd = a.buildCommand(['frontend'], {});
    assert.strictEqual(cmd.cwd, appDir, 'cwd is the app dir, not the repo root');
    assert.ok(cmd.args.includes('.'), 'the app target is relativized to "."');
  });
});

// ===========================================================================
// Bug B — root-config discovery
// ===========================================================================
describe('Bug B — discovery binds the right directories', () => {
  const TMP = path.join(os.tmpdir(), `gimme-bugB-${Date.now()}`);

  before(async () => {
    // Repo-root ruff config governing a conventional backend/ tree.
    await fs.ensureDir(TMP);
    await fs.writeFile(
      path.join(TMP, 'pyproject.toml'),
      '[tool.ruff]\nline-length = 100\n'
    );
    // Real Python app — NO local manifest (ruff is configured at the root).
    await fs.ensureDir(path.join(TMP, 'backend'));
    await fs.writeFile(path.join(TMP, 'backend', 'main.py'), 'x = 1\n');
    // A nested load-tests dir with only a bare requirements.txt (too weak).
    await fs.ensureDir(path.join(TMP, 'backend', 'load-tests'));
    await fs.writeFile(
      path.join(TMP, 'backend', 'load-tests', 'requirements.txt'),
      'locust\n'
    );
    // Real JS apps with their own manifests.
    await fs.ensureDir(path.join(TMP, 'frontend'));
    await fs.writeFile(path.join(TMP, 'frontend', 'package.json'), '{"name":"fe"}');
    await fs.ensureDir(path.join(TMP, 'keycloakify'));
    await fs.writeFile(path.join(TMP, 'keycloakify', 'package.json'), '{"name":"kc"}');
  });
  after(async () => {
    await fs.remove(TMP);
  });

  it('binds the repo-root ruff config to the root, not nothing', () => {
    const apps = projectModel.discoverApps(TMP);
    const byPath = Object.fromEntries(apps.map((a) => [a.appPath, a.linters]));
    assert.deepStrictEqual(byPath['.'], ['ruff'], 'root pyproject binds ruff at root');
    assert.deepStrictEqual(byPath['frontend'], ['eslint']);
    assert.deepStrictEqual(byPath['keycloakify'], ['eslint']);
  });

  it('does NOT bind a nested dir that only has a bare requirements.txt', () => {
    const apps = projectModel.discoverApps(TMP);
    assert.ok(
      !apps.some((a) => a.appPath === 'backend/load-tests'),
      'requirements.txt is too weak a marker to bind an app'
    );
  });

  it('warns about the ambiguous root-config + nested-apps layout', () => {
    const warnings = projectModel.discoveryWarnings(TMP);
    assert.ok(warnings.length > 0, 'discovery emits a warning');
    assert.match(warnings[0], /apps/, 'warning recommends an explicit apps map');
  });

  it('writeAppsConfig pins the discovered layout into a config file', async () => {
    const apps = projectModel.discoverApps(TMP);
    const result = await configManager.writeAppsConfig(TMP, apps);
    assert.strictEqual(result.created, true);
    const written = require(result.path);
    assert.deepStrictEqual(written.apps['.'], { linters: ['ruff'] });
    assert.deepStrictEqual(written.apps['frontend'], { linters: ['eslint'] });
    // It must never clobber an existing config.
    const second = await configManager.writeAppsConfig(TMP, apps);
    assert.strictEqual(second.created, false);
  });
});

// ===========================================================================
// Bug C — errored / unavailable must not collapse into "skipped"
// ===========================================================================
const flakyState = { mode: 'available' };

class FlakyAdapter extends LinterAdapter {
  get id() {
    return 'flaky';
  }
  get languages() {
    return ['flaky'];
  }
  get sourceExtensions() {
    return ['.flk'];
  }
  detect() {
    return true;
  }
  available() {
    return flakyState.mode !== 'unavailable';
  }
  version() {
    return '1.0.0';
  }
  configFiles() {
    return [];
  }
  lint() {
    if (flakyState.mode === 'error') throw new Error('flaky linter crashed');
    // When available, return a violation — to prove that an incomplete
    // baseline does NOT make this flood the check as a "new" violation.
    return [
      createViolation({
        file: 'a.flk',
        ruleId: 'flaky-rule',
        message: 'pre-existing problem',
        source: 'flaky',
      }),
    ];
  }
}

describe('Bug C — incomplete baselines stay distinguishable', () => {
  const TMP = path.join(os.tmpdir(), `gimme-bugC-${Date.now()}`);

  before(async () => {
    adapters.registerAdapter('flaky', FlakyAdapter);
    await fs.ensureDir(TMP);
    await fs.writeFile(
      path.join(TMP, 'gimme-the-lint.config.js'),
      "module.exports = { apps: { '.': { linters: ['flaky'] } } };\n"
    );
    await fs.writeFile(path.join(TMP, 'a.flk'), 'code\n');
  });
  after(async () => {
    await fs.remove(TMP);
  });

  it('isIncompleteStatus distinguishes unavailable/error from clean', () => {
    assert.strictEqual(baselineStore.isIncompleteStatus('unavailable'), true);
    assert.strictEqual(baselineStore.isIncompleteStatus('error'), true);
    assert.strictEqual(baselineStore.isIncompleteStatus('clean'), false);
    assert.strictEqual(baselineStore.isIncompleteStatus('baselined'), false);
  });

  it('an unavailable linter is recorded UNAVAILABLE and surfaced as incomplete', async () => {
    flakyState.mode = 'unavailable';
    const report = await runBaseline(TMP);
    assert.strictEqual(report.units[0].sections[0].status, 'unavailable');
    assert.strictEqual(report.incomplete.length, 1);
    assert.strictEqual(report.incomplete[0].status, 'unavailable');
  });

  it('a linter that throws is recorded ERROR and surfaced as incomplete', async () => {
    flakyState.mode = 'error';
    const report = await runBaseline(TMP);
    assert.strictEqual(report.units[0].sections[0].status, 'error');
    assert.strictEqual(report.incomplete.length, 1);
    assert.strictEqual(report.incomplete[0].status, 'error');
  });

  it('findIncompleteBaselines reports an incomplete committed baseline', async () => {
    flakyState.mode = 'unavailable';
    await runBaseline(TMP);
    const incomplete = await findIncompleteBaselines(TMP);
    assert.strictEqual(incomplete.length, 1);
    assert.strictEqual(incomplete[0].linter, 'flaky');
    assert.strictEqual(incomplete[0].status, 'unavailable');
  });

  it('check warns "needs-baseline" instead of flooding new violations', async () => {
    // Baseline while unavailable → an UNAVAILABLE (incomplete) section.
    flakyState.mode = 'unavailable';
    await runBaseline(TMP);
    // Now the linter is available and finds a pre-existing violation.
    flakyState.mode = 'available';
    const report = await runCheck(TMP, { changedOnly: false });
    const unit = report.units[0];
    assert.strictEqual(unit.status, 'needs-baseline', 'incomplete baseline → warn');
    assert.strictEqual(report.ok, true, 'the commit is NOT blocked by a flood');
  });
});
