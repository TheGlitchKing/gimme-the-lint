'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const { detectLegacy, findLegacyDirs, migrate } = require('../lib/migrate');

describe('migrate — detectLegacy', () => {
  const TMP = path.join(os.tmpdir(), `gimme-test-mig-d-${Date.now()}`);

  before(async () => {
    await fs.ensureDir(path.join(TMP, 'frontend', '.lttf'));
    await fs.ensureDir(path.join(TMP, 'backend', '.lttf-ruff'));
    await fs.writeFile(path.join(TMP, 'frontend', '.lttf', 'baseline-api.json'), '[]');
  });
  after(async () => {
    await fs.remove(TMP);
  });

  it('finds legacy .lttf and .lttf-ruff directories', () => {
    const dirs = findLegacyDirs(TMP).sort();
    assert.deepStrictEqual(dirs, ['backend/.lttf-ruff', 'frontend/.lttf']);
  });

  it('reports hasLegacy for a v1 project', () => {
    assert.strictEqual(detectLegacy(TMP).hasLegacy, true);
  });

  it('reports no legacy for a clean project', async () => {
    const clean = path.join(os.tmpdir(), `gimme-test-mig-clean-${Date.now()}`);
    await fs.ensureDir(clean);
    assert.strictEqual(detectLegacy(clean).hasLegacy, false);
    await fs.remove(clean);
  });
});

describe('migrate — migrate()', () => {
  const TMP = path.join(os.tmpdir(), `gimme-test-mig-m-${Date.now()}`);

  before(async () => {
    await fs.ensureDir(TMP);
    // A v1 project: a real package + a legacy baseline directory.
    await fs.writeFile(path.join(TMP, 'package.json'), '{"name":"legacy-app"}');
    await fs.ensureDir(path.join(TMP, '.lttf'));
    await fs.writeFile(path.join(TMP, '.lttf', 'baseline-src.json'), '[]');
    await fs.writeFile(path.join(TMP, '.lttf', '.baseline-manifest.json'), '{}');
  });
  after(async () => {
    await fs.remove(TMP);
  });

  it('backs up legacy dirs and re-baselines into .gtl/', async () => {
    const result = await migrate(TMP);
    assert.strictEqual(result.migrated, true);
    assert.ok(result.backedUp.includes('.lttf'));

    // Legacy dir is gone from its original location...
    assert.strictEqual(await fs.pathExists(path.join(TMP, '.lttf')), false);
    // ...and preserved under the backup path...
    assert.ok(
      await fs.pathExists(path.join(TMP, result.backupPath, '.lttf', 'baseline-src.json'))
    );
    // ...and a fresh .gtl/ layout exists.
    assert.ok(await fs.pathExists(path.join(TMP, '.gtl', 'manifest.json')));
  });

  it('leaves no legacy layout behind after migration', () => {
    assert.strictEqual(detectLegacy(TMP).hasLegacy, false);
  });

  it('is a no-op on a project with no legacy layout', async () => {
    const clean = path.join(os.tmpdir(), `gimme-test-mig-noop-${Date.now()}`);
    await fs.ensureDir(clean);
    const result = await migrate(clean);
    assert.strictEqual(result.migrated, false);
    assert.match(result.reason, /[Nn]o legacy/);
    await fs.remove(clean);
  });
});
