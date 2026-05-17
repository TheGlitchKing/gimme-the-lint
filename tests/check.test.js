'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const adapters = require('../lib/adapters');
const { LinterAdapter } = require('../lib/adapters/adapter');
const { runCheck } = require('../lib/check');
const { runBaseline } = require('../lib/baseline');
const { resolveUnits } = require('../lib/units');
const baselineStore = require('../lib/baseline-store');
const { createViolation } = require('../lib/violation');

// A fully in-memory adapter so check/baseline orchestration can be tested
// without shelling out to a real linter.
const fakeState = { available: true, violations: [] };

class FakeAdapter extends LinterAdapter {
  get id() {
    return 'fake';
  }
  get languages() {
    return ['fake-lang'];
  }
  get sourceExtensions() {
    return ['.fk'];
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
    return fakeState.violations;
  }
}

const TMP = path.join(os.tmpdir(), `gimme-test-check-${Date.now()}`);

function v(props) {
  return createViolation({ source: 'fake', ...props });
}

describe('check / baseline orchestration', () => {
  before(async () => {
    adapters.registerAdapter('fake', FakeAdapter);
    await fs.ensureDir(TMP);
    // A project whose single app is linted by the fake adapter.
    await fs.writeFile(
      path.join(TMP, 'gimme-the-lint.config.js'),
      "module.exports = { apps: { '.': { linters: ['fake'] } } };\n"
    );
    await fs.writeFile(path.join(TMP, 'code.fk'), 'fake code\n');
  });

  after(async () => {
    await fs.remove(TMP);
  });

  it('resolveUnits reads the v2 apps config', () => {
    const units = resolveUnits(TMP);
    assert.strictEqual(units.length, 1);
    assert.deepStrictEqual(units[0].linters, ['fake']);
    assert.strictEqual(units[0].id, 'root');
  });

  it('runBaseline captures violations into .gtl/apps/<app>/baseline.json', async () => {
    fakeState.available = true;
    fakeState.violations = [
      v({ file: 'code.fk', ruleId: 'R1', message: 'pre-existing one' }),
      v({ file: 'code.fk', ruleId: 'R2', message: 'pre-existing two' }),
    ];
    const report = await runBaseline(TMP);
    assert.strictEqual(report.unitCount, 1);

    const baselineFile = path.join(TMP, '.gtl', 'apps', 'root', 'baseline.json');
    assert.ok(await fs.pathExists(baselineFile), 'baseline.json should exist');
    const stored = await baselineStore.readBaseline(baselineFile);
    const section = baselineStore.getLinterSection(stored, 'fake');
    assert.strictEqual(section.total, 2);
    assert.strictEqual(section.status, 'baselined');
  });

  it('runCheck passes when no NEW violations appear', async () => {
    // Same two violations that were baselined.
    const report = await runCheck(TMP, { changedOnly: false });
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.newViolations, 0);
    assert.strictEqual(report.units[0].status, 'pass');
  });

  it('runCheck fails when a NEW violation appears', async () => {
    fakeState.violations = [
      v({ file: 'code.fk', ruleId: 'R1', message: 'pre-existing one' }),
      v({ file: 'code.fk', ruleId: 'R2', message: 'pre-existing two' }),
      v({ file: 'code.fk', ruleId: 'R3', message: 'brand new violation' }),
    ];
    const report = await runCheck(TMP, { changedOnly: false });
    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.newViolations, 1);
    assert.strictEqual(report.units[0].status, 'fail');
    assert.strictEqual(report.units[0].diff.new[0].ruleId, 'R3');
  });

  it('warn+skips when the linter binary is unavailable', async () => {
    fakeState.available = false;
    const report = await runCheck(TMP, { changedOnly: false });
    assert.strictEqual(report.units[0].status, 'skipped');
    // A skip never blocks the commit.
    assert.strictEqual(report.ok, true);
    fakeState.available = true;
  });

  it('strict mode throws when the linter is unavailable', async () => {
    fakeState.available = false;
    await assert.rejects(
      () => runCheck(TMP, { changedOnly: false, strict: true }),
      /not installed/
    );
    fakeState.available = true;
  });

  it('baseline records skipped status when the linter is unavailable', async () => {
    fakeState.available = false;
    const report = await runBaseline(TMP);
    assert.strictEqual(report.units[0].sections[0].status, 'skipped');
    const stored = await baselineStore.readBaseline(
      path.join(TMP, '.gtl', 'apps', 'root', 'baseline.json')
    );
    assert.strictEqual(
      baselineStore.getLinterSection(stored, 'fake').status,
      'skipped'
    );
    fakeState.available = true;
  });
});
