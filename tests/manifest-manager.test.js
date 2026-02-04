'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const manifestManager = require('../lib/manifest-manager');

const TMP = path.join(os.tmpdir(), `gimme-test-mm-${Date.now()}`);

describe('manifest-manager', () => {
  before(async () => {
    await fs.ensureDir(TMP);
    // Create a mock config file for hashing
    await fs.writeFile(path.join(TMP, 'eslint.config.js'), 'module.exports = {};');
  });

  after(async () => {
    await fs.remove(TMP);
  });

  describe('hashFile', () => {
    it('should return md5 hash of file contents', async () => {
      const hash = await manifestManager.hashFile(path.join(TMP, 'eslint.config.js'));
      assert.ok(typeof hash === 'string');
      assert.strictEqual(hash.length, 32); // MD5 hex is 32 chars
    });

    it('should return "unknown" for nonexistent file', async () => {
      const hash = await manifestManager.hashFile(path.join(TMP, 'nope.js'));
      assert.strictEqual(hash, 'unknown');
    });

    it('should return different hashes for different content', async () => {
      await fs.writeFile(path.join(TMP, 'a.js'), 'aaa');
      await fs.writeFile(path.join(TMP, 'b.js'), 'bbb');
      const hashA = await manifestManager.hashFile(path.join(TMP, 'a.js'));
      const hashB = await manifestManager.hashFile(path.join(TMP, 'b.js'));
      assert.notStrictEqual(hashA, hashB);
    });
  });

  describe('calculateAge', () => {
    it('should return 0 for today', () => {
      const age = manifestManager.calculateAge(new Date().toISOString());
      assert.ok(age >= 0 && age <= 1);
    });

    it('should return correct age for past date', () => {
      const past = new Date();
      past.setDate(past.getDate() - 10);
      const age = manifestManager.calculateAge(past.toISOString());
      assert.ok(age >= 9 && age <= 11);
    });
  });

  describe('createManifest', () => {
    it('should create manifest with all required fields', async () => {
      const manifest = await manifestManager.createManifest({
        tool: 'eslint',
        version: '9.0.0',
        directories: ['api', 'components', 'hooks'],
        violations: 42,
        configPath: path.join(TMP, 'eslint.config.js'),
        testExcluded: ['__tests__', 'e2e'],
      });

      assert.ok(manifest.created_at);
      assert.strictEqual(manifest.tool, 'eslint');
      assert.strictEqual(manifest.version, '9.0.0');
      assert.deepStrictEqual(manifest.directories_baselined, ['api', 'components', 'hooks']);
      assert.strictEqual(manifest.total_directories, 3);
      assert.strictEqual(manifest.total_violations, 42);
      assert.strictEqual(manifest.config_hash.length, 32);
      assert.deepStrictEqual(manifest.test_excluded, ['__tests__', 'e2e']);
    });
  });

  describe('readManifest / writeManifest', () => {
    it('should write and read back manifest', async () => {
      const manifestPath = path.join(TMP, '.baseline-manifest.json');
      const manifest = {
        created_at: new Date().toISOString(),
        tool: 'ruff',
        version: '0.4.0',
        directories_baselined: ['routers', 'services'],
        total_directories: 2,
        total_violations: 10,
        config_hash: 'abc123',
        test_excluded: ['tests'],
      };

      await manifestManager.writeManifest(manifestPath, manifest);
      const read = await manifestManager.readManifest(manifestPath);
      assert.deepStrictEqual(read, manifest);
    });

    it('should return null for nonexistent manifest', async () => {
      const result = await manifestManager.readManifest(path.join(TMP, 'nope.json'));
      assert.strictEqual(result, null);
    });

    it('should create parent directories', async () => {
      const deepPath = path.join(TMP, 'deep', 'nested', 'manifest.json');
      await manifestManager.writeManifest(deepPath, { test: true });
      const result = await manifestManager.readManifest(deepPath);
      assert.deepStrictEqual(result, { test: true });
    });
  });
});
