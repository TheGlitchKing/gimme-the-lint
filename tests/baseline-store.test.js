'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const baselineStore = require('../lib/baseline-store');
const { createViolation } = require('../lib/violation');

const TMP = path.join(os.tmpdir(), `gimme-test-bs-${Date.now()}`);

function v(props) {
  return createViolation({ source: 'eslint', ...props });
}

describe('baseline-store', () => {
  before(async () => {
    await fs.ensureDir(TMP);
  });

  after(async () => {
    await fs.remove(TMP);
  });

  describe('buildFingerprintMap', () => {
    it('counts violations by fingerprint', () => {
      const map = baselineStore.buildFingerprintMap([
        v({ file: 'a.js', ruleId: 'no-x', message: 'm' }),
        v({ file: 'a.js', line: 99, ruleId: 'no-x', message: 'm' }),
        v({ file: 'a.js', ruleId: 'no-y', message: 'm2' }),
      ]);
      const counts = Object.values(map).sort();
      assert.deepStrictEqual(counts, [1, 2]);
    });

    it('returns an empty map for no violations', () => {
      assert.deepStrictEqual(baselineStore.buildFingerprintMap([]), {});
    });
  });

  describe('createLinterSection', () => {
    it('captures violations with baselined status', () => {
      const section = baselineStore.createLinterSection(
        [v({ file: 'a.js', ruleId: 'no-x', message: 'm' })],
        { toolVersion: '9.0.0', configHash: 'abc' }
      );
      assert.strictEqual(section.status, baselineStore.STATUS.BASELINED);
      assert.strictEqual(section.total, 1);
      assert.strictEqual(section.tool_version, '9.0.0');
      assert.strictEqual(section.config_hash, 'abc');
      assert.strictEqual(Object.keys(section.fingerprints).length, 1);
    });

    it('marks an empty run as clean', () => {
      const section = baselineStore.createLinterSection([]);
      assert.strictEqual(section.status, baselineStore.STATUS.CLEAN);
      assert.strictEqual(section.total, 0);
    });

    it('honors an explicit status override', () => {
      const section = baselineStore.createLinterSection([], {
        status: baselineStore.STATUS.SKIPPED,
      });
      assert.strictEqual(section.status, baselineStore.STATUS.SKIPPED);
    });
  });

  describe('section management', () => {
    it('sets and gets linter sections', () => {
      const baseline = baselineStore.emptyBaseline();
      const section = baselineStore.createLinterSection([
        v({ file: 'a.js', ruleId: 'no-x', message: 'm' }),
      ]);
      baselineStore.setLinterSection(baseline, 'eslint', section);
      assert.deepStrictEqual(baselineStore.getLinterSection(baseline, 'eslint'), section);
    });

    it('returns null for an absent linter section', () => {
      assert.strictEqual(
        baselineStore.getLinterSection(baselineStore.emptyBaseline(), 'ruff'),
        null
      );
      assert.strictEqual(baselineStore.getLinterSection(null, 'ruff'), null);
    });

    it('emptyBaseline carries the current schema version', () => {
      assert.strictEqual(
        baselineStore.emptyBaseline().schema,
        baselineStore.SCHEMA_VERSION
      );
    });
  });

  describe('readBaseline / writeBaseline', () => {
    it('writes and reads back a baseline', async () => {
      const baseline = baselineStore.emptyBaseline();
      baselineStore.setLinterSection(
        baseline,
        'ruff',
        baselineStore.createLinterSection([v({ file: 'x.py', ruleId: 'E501', message: 'long' })])
      );
      const file = path.join(TMP, 'apps', 'svc', 'baseline.json');
      await baselineStore.writeBaseline(file, baseline);
      const read = await baselineStore.readBaseline(file);
      assert.deepStrictEqual(read, baseline);
    });

    it('creates parent directories on write', async () => {
      const file = path.join(TMP, 'deep', 'nested', 'baseline.json');
      await baselineStore.writeBaseline(file, baselineStore.emptyBaseline());
      assert.ok(await fs.pathExists(file));
    });

    it('returns null for a missing baseline file', async () => {
      assert.strictEqual(
        await baselineStore.readBaseline(path.join(TMP, 'nope.json')),
        null
      );
    });

    it('returns null for an unparseable baseline file', async () => {
      const bad = path.join(TMP, 'bad.json');
      await fs.writeFile(bad, '{ not json');
      assert.strictEqual(await baselineStore.readBaseline(bad), null);
    });
  });
});
