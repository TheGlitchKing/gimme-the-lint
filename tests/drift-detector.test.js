'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const driftDetector = require('../lib/drift-detector');
const manifestManager = require('../lib/manifest-manager');

const TMP = path.join(os.tmpdir(), `gimme-test-drift-${Date.now()}`);

describe('drift-detector', () => {
  let manifestPath;
  let configPath;

  before(async () => {
    await fs.ensureDir(TMP);
    manifestPath = path.join(TMP, '.baseline-manifest.json');
    configPath = path.join(TMP, 'eslint.config.js');

    // Create config file
    await fs.writeFile(configPath, 'module.exports = { rules: {} };');

    // Create a baseline manifest
    const manifest = await manifestManager.createManifest({
      tool: 'eslint',
      version: '9.0.0',
      directories: ['api', 'components', 'hooks'],
      violations: 10,
      configPath,
      testExcluded: ['__tests__'],
    });
    await manifestManager.writeManifest(manifestPath, manifest);
  });

  after(async () => {
    await fs.remove(TMP);
  });

  describe('detectDrift', () => {
    it('should detect no drift when nothing changed', async () => {
      const drift = await driftDetector.detectDrift({
        manifestPath,
        configPath,
        currentDirs: ['api', 'components', 'hooks'],
      });

      assert.strictEqual(drift.hasDirectoryDrift, false);
      assert.strictEqual(drift.hasConfigDrift, false);
      assert.deepStrictEqual(drift.addedDirs, []);
      assert.deepStrictEqual(drift.removedDirs, []);
    });

    it('should detect added directories', async () => {
      const drift = await driftDetector.detectDrift({
        manifestPath,
        configPath,
        currentDirs: ['api', 'components', 'hooks', 'features', 'utils'],
      });

      assert.strictEqual(drift.hasDirectoryDrift, true);
      assert.deepStrictEqual(drift.addedDirs, ['features', 'utils']);
      assert.deepStrictEqual(drift.removedDirs, []);
    });

    it('should detect removed directories', async () => {
      const drift = await driftDetector.detectDrift({
        manifestPath,
        configPath,
        currentDirs: ['api'],
      });

      assert.strictEqual(drift.hasDirectoryDrift, true);
      assert.deepStrictEqual(drift.addedDirs, []);
      assert.deepStrictEqual(drift.removedDirs, ['components', 'hooks']);
    });

    it('should detect config drift', async () => {
      // Change config file
      await fs.writeFile(configPath, 'module.exports = { rules: { new: true } };');

      const drift = await driftDetector.detectDrift({
        manifestPath,
        configPath,
        currentDirs: ['api', 'components', 'hooks'],
      });

      assert.strictEqual(drift.hasConfigDrift, true);
      assert.ok(drift.details.some((d) => d.includes('Configuration changed')));

      // Restore
      await fs.writeFile(configPath, 'module.exports = { rules: {} };');
    });

    it('should return noManifest when manifest missing', async () => {
      const drift = await driftDetector.detectDrift({
        manifestPath: path.join(TMP, 'nope.json'),
        configPath,
        currentDirs: ['api'],
      });

      assert.strictEqual(drift.noManifest, true);
    });
  });

  describe('formatDriftReport', () => {
    it('should return null when no drift', () => {
      const report = driftDetector.formatDriftReport({
        hasDirectoryDrift: false,
        hasConfigDrift: false,
        hasTimeDrift: false,
        details: [],
      });
      assert.strictEqual(report, null);
    });

    it('should format drift details', () => {
      const report = driftDetector.formatDriftReport({
        hasDirectoryDrift: true,
        hasConfigDrift: false,
        hasTimeDrift: false,
        details: ['Added directories: features, utils'],
      });
      assert.ok(report.includes('Drift Detected'));
      assert.ok(report.includes('features, utils'));
    });

    it('should handle noManifest case', () => {
      const report = driftDetector.formatDriftReport({
        noManifest: true,
        message: 'No manifest found',
      });
      assert.strictEqual(report, 'No manifest found');
    });
  });

  describe('autoHeal', () => {
    it('should update manifest with current state', async () => {
      const healPath = path.join(TMP, 'heal-manifest.json');

      // Create old manifest
      const oldManifest = await manifestManager.createManifest({
        tool: 'eslint',
        version: '9.0.0',
        directories: ['api', 'components'],
        violations: 10,
        configPath,
        testExcluded: ['__tests__'],
      });
      await manifestManager.writeManifest(healPath, oldManifest);

      // Auto-heal with new state
      const result = await driftDetector.autoHeal({
        manifestPath: healPath,
        configPath,
        currentDirs: ['api', 'components', 'features'],
        tool: 'eslint',
        version: '9.0.0',
        currentViolations: 8,
        testExcluded: ['__tests__'],
      });

      assert.deepStrictEqual(result.oldDirs, ['api', 'components']);
      assert.deepStrictEqual(result.newDirs, ['api', 'components', 'features']);
      assert.strictEqual(result.oldViolations, 10);
      assert.strictEqual(result.newViolations, 8);

      // Verify manifest was updated
      const updated = await manifestManager.readManifest(healPath);
      assert.strictEqual(updated.total_directories, 3);
      assert.strictEqual(updated.total_violations, 8);
      assert.ok(updated.directories_baselined.includes('features'));
    });
  });
});
