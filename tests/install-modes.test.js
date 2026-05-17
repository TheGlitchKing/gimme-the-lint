'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const adapters = require('../lib/adapters');
const { LinterAdapter } = require('../lib/adapters/adapter');
const { runBaseline } = require('../lib/baseline');
const { runCheck } = require('../lib/check');
const toolchain = require('../lib/toolchain');
const installer = require('../lib/installer');
const baselineStore = require('../lib/baseline-store');
const { createViolation } = require('../lib/violation');

// A fake adapter whose availability and violations are test-controlled.
const fakeState = { available: true };

class FakeInstallAdapter extends LinterAdapter {
  get id() {
    return 'fake-5';
  }
  get languages() {
    return ['f5'];
  }
  detect() {
    return true;
  }
  available() {
    return fakeState.available;
  }
  version() {
    return '1.0.0';
  }
  configFiles() {
    return [];
  }
  lint() {
    return [createViolation({ file: 'x.f5', ruleId: 'R1', message: 'a violation', source: 'fake-5' })];
  }
}

function writeConfig(dir) {
  return fs.writeFile(
    path.join(dir, 'gimme-the-lint.config.js'),
    "module.exports = { apps: { '.': { linters: ['fake-5'] } } };\n"
  );
}

describe('greenfield mode (--no-baseline / --empty)', () => {
  const TMP = path.join(os.tmpdir(), `gimme-test-green-${Date.now()}`);

  before(async () => {
    adapters.registerAdapter('fake-5', FakeInstallAdapter);
    fakeState.available = true;
    await fs.ensureDir(TMP);
    await writeConfig(TMP);
  });
  after(async () => {
    await fs.remove(TMP);
  });

  it('writes an EMPTY baseline even when the linter finds violations', async () => {
    await runBaseline(TMP, { noBaseline: true });
    const stored = await baselineStore.readBaseline(
      path.join(TMP, '.gtl', 'apps', 'root', 'baseline.json')
    );
    const section = baselineStore.getLinterSection(stored, 'fake-5');
    assert.strictEqual(section.total, 0);
    assert.strictEqual(section.status, 'clean');
    assert.deepStrictEqual(section.fingerprints, {});
  });

  it('treats every violation as new after a greenfield baseline', async () => {
    const report = await runCheck(TMP, { changedOnly: false });
    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.newViolations, 1);
  });
});

describe('offline mode — toolchain gaps', () => {
  const TMP = path.join(os.tmpdir(), `gimme-test-offline-${Date.now()}`);

  before(async () => {
    adapters.registerAdapter('fake-5', FakeInstallAdapter);
    await fs.ensureDir(TMP);
    await writeConfig(TMP);
  });
  after(async () => {
    await fs.remove(TMP);
  });

  it('findGaps reports an app with code but no linter binary', () => {
    fakeState.available = false;
    const gaps = toolchain.findGaps(TMP);
    assert.strictEqual(gaps.length, 1);
    assert.strictEqual(gaps[0].linter, 'fake-5');
    fakeState.available = true;
  });

  it('findGaps reports nothing when the linter is available', () => {
    fakeState.available = true;
    assert.deepStrictEqual(toolchain.findGaps(TMP), []);
  });

  it('offline install skips toolchain setup and records gaps', async () => {
    fakeState.available = false;
    const result = await installer.init(TMP, { offline: true });
    assert.ok(
      result.steps.some((s) => s.includes('Offline mode')),
      'should record that offline setup was skipped'
    );
    assert.ok(Array.isArray(result.offlineGaps));
    assert.ok(
      result.offlineGaps.some((g) => g.linter === 'fake-5'),
      'should surface the missing linter as an offline gap'
    );
    fakeState.available = true;
  });
});
