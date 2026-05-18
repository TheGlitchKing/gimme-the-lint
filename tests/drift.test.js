'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const adapters = require('../lib/adapters');
const { LinterAdapter } = require('../lib/adapters/adapter');
const { runBaseline } = require('../lib/baseline');
const { detectDrift, formatDriftReport } = require('../lib/drift');

// ---------------------------------------------------------------------------
// Block A: app added / removed drift, via real package manifests.
// ---------------------------------------------------------------------------
describe('drift — app added/removed', () => {
  const TMP = path.join(os.tmpdir(), `gimme-test-drift-a-${Date.now()}`);

  before(async () => {
    await fs.ensureDir(path.join(TMP, 'apps', 'a'));
    await fs.writeFile(path.join(TMP, 'apps', 'a', 'package.json'), '{"dependencies":{}}');
    await fs.writeFile(path.join(TMP, 'apps', 'a', 'index.js'), 'export const a = 1;\n');
  });
  after(async () => {
    await fs.remove(TMP);
  });

  it('reports no drift right after baselining', async () => {
    await runBaseline(TMP);
    const drift = await detectDrift(TMP);
    assert.strictEqual(drift.hasDrift, false);
    assert.strictEqual(formatDriftReport(drift), null);
  });

  it('detects a newly added app', async () => {
    await fs.ensureDir(path.join(TMP, 'apps', 'b'));
    await fs.writeFile(path.join(TMP, 'apps', 'b', 'package.json'), '{"dependencies":{}}');
    await fs.writeFile(path.join(TMP, 'apps', 'b', 'index.js'), 'export const b = 1;\n');
    const drift = await detectDrift(TMP);
    assert.strictEqual(drift.hasDrift, true);
    assert.deepStrictEqual(drift.addedApps, ['apps/b']);
  });

  it('detects a removed app', async () => {
    await fs.remove(path.join(TMP, 'apps', 'a'));
    const drift = await detectDrift(TMP);
    assert.ok(drift.removedApps.includes('apps/a'));
  });

  it('reports noManifest before any baseline exists', async () => {
    const fresh = path.join(os.tmpdir(), `gimme-test-drift-none-${Date.now()}`);
    await fs.ensureDir(fresh);
    const drift = await detectDrift(fresh);
    assert.strictEqual(drift.noManifest, true);
    await fs.remove(fresh);
  });
});

// ---------------------------------------------------------------------------
// Block B: config / version drift, via an in-memory adapter we fully control.
// ---------------------------------------------------------------------------
const fakeState = { version: '1.0.0' };

class FakeDriftAdapter extends LinterAdapter {
  get id() {
    return 'fake-drift';
  }
  get languages() {
    return ['fd'];
  }
  detect() {
    return true;
  }
  available() {
    return true;
  }
  version() {
    return fakeState.version;
  }
  configFiles() {
    return ['fake.config'];
  }
  lint() {
    return [];
  }
}

describe('drift — config and version', () => {
  const TMP = path.join(os.tmpdir(), `gimme-test-drift-b-${Date.now()}`);

  before(async () => {
    adapters.registerAdapter('fake-drift', FakeDriftAdapter);
    await fs.ensureDir(TMP);
    await fs.writeFile(
      path.join(TMP, 'gimme-the-lint.config.js'),
      "module.exports = { apps: { '.': { linters: ['fake-drift'] } } };\n"
    );
    await fs.writeFile(path.join(TMP, 'fake.config'), 'rules = original\n');
    fakeState.version = '1.0.0';
    await runBaseline(TMP);
  });
  after(async () => {
    await fs.remove(TMP);
  });

  it('reports no drift when nothing changed', async () => {
    const drift = await detectDrift(TMP);
    assert.strictEqual(drift.hasDrift, false);
  });

  it('detects a linter config change', async () => {
    await fs.writeFile(path.join(TMP, 'fake.config'), 'rules = CHANGED\n');
    const drift = await detectDrift(TMP);
    const configDrift = drift.linterDrift.find((d) => d.type === 'config');
    assert.ok(configDrift, 'expected config drift');
    assert.strictEqual(configDrift.linter, 'fake-drift');
    // Restore so the version test starts clean.
    await fs.writeFile(path.join(TMP, 'fake.config'), 'rules = original\n');
  });

  it('detects a linter version bump', async () => {
    fakeState.version = '2.0.0';
    const drift = await detectDrift(TMP);
    const versionDrift = drift.linterDrift.find((d) => d.type === 'version');
    assert.ok(versionDrift, 'expected version drift');
    assert.strictEqual(versionDrift.from, '1.0.0');
    assert.strictEqual(versionDrift.to, '2.0.0');
  });
});
