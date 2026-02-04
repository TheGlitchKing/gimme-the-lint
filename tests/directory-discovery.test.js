'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { discoverDirs, discoverFrontendDirs, discoverBackendDirs, isTestDir } = require('../lib/directory-discovery');

const TMP = path.join(os.tmpdir(), `gimme-test-dd-${Date.now()}`);

describe('directory-discovery', () => {
  before(() => {
    // Create test directory structure
    const dirs = [
      'frontend/src/api',
      'frontend/src/components',
      'frontend/src/features',
      'frontend/src/hooks',
      'frontend/src/__tests__',
      'frontend/src/testing',
      'frontend/src/e2e',
      'backend/app/routers',
      'backend/app/services',
      'backend/app/models',
      'backend/app/tests',
      'backend/app/__pycache__',
    ];
    for (const d of dirs) {
      fs.mkdirSync(path.join(TMP, d), { recursive: true });
    }
  });

  after(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  describe('isTestDir', () => {
    it('should identify test directories', () => {
      assert.strictEqual(isTestDir('__tests__'), true);
      assert.strictEqual(isTestDir('tests'), true);
      assert.strictEqual(isTestDir('Testing'), true);
      assert.strictEqual(isTestDir('e2e'), true);
      assert.strictEqual(isTestDir('__pycache__'), true);
      assert.strictEqual(isTestDir('.hidden'), true);
    });

    it('should pass production directories', () => {
      assert.strictEqual(isTestDir('api'), false);
      assert.strictEqual(isTestDir('components'), false);
      assert.strictEqual(isTestDir('routers'), false);
      assert.strictEqual(isTestDir('services'), false);
      assert.strictEqual(isTestDir('features'), false);
    });
  });

  describe('discoverDirs', () => {
    it('should discover directories excluding test dirs', () => {
      const dirs = discoverDirs(path.join(TMP, 'frontend/src'));
      assert.ok(dirs.includes('api'));
      assert.ok(dirs.includes('components'));
      assert.ok(dirs.includes('features'));
      assert.ok(dirs.includes('hooks'));
      assert.ok(!dirs.includes('__tests__'));
      assert.ok(!dirs.includes('testing'));
      assert.ok(!dirs.includes('e2e'));
    });

    it('should return empty array for nonexistent path', () => {
      const dirs = discoverDirs(path.join(TMP, 'nonexistent'));
      assert.deepStrictEqual(dirs, []);
    });

    it('should return sorted results', () => {
      const dirs = discoverDirs(path.join(TMP, 'frontend/src'));
      const sorted = [...dirs].sort();
      assert.deepStrictEqual(dirs, sorted);
    });
  });

  describe('discoverFrontendDirs', () => {
    it('should discover frontend production directories', () => {
      const dirs = discoverFrontendDirs(TMP);
      assert.ok(dirs.includes('api'));
      assert.ok(dirs.includes('components'));
      assert.ok(!dirs.includes('__tests__'));
      assert.ok(!dirs.includes('e2e'));
    });
  });

  describe('discoverBackendDirs', () => {
    it('should discover backend production directories', () => {
      const dirs = discoverBackendDirs(TMP);
      assert.ok(dirs.includes('routers'));
      assert.ok(dirs.includes('services'));
      assert.ok(dirs.includes('models'));
      assert.ok(!dirs.includes('tests'));
      assert.ok(!dirs.includes('__pycache__'));
    });
  });
});
