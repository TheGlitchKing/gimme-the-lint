'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const configManager = require('../lib/config-manager');

const TMP = path.join(os.tmpdir(), `gimme-test-cfg-${Date.now()}`);

describe('config-manager', () => {
  before(async () => {
    await fs.ensureDir(TMP);
  });

  after(async () => {
    await fs.remove(TMP);
  });

  describe('detectProjectType', () => {
    it('should detect monorepo', async () => {
      const dir = path.join(TMP, 'monorepo');
      await fs.ensureDir(path.join(dir, 'frontend'));
      await fs.ensureDir(path.join(dir, 'backend'));
      const type = await configManager.detectProjectType(dir);
      assert.strictEqual(type, 'monorepo');
    });

    it('should detect frontend-only', async () => {
      const dir = path.join(TMP, 'fe-only');
      await fs.ensureDir(path.join(dir, 'src'));
      await fs.writeJson(path.join(dir, 'package.json'), { name: 'test' });
      const type = await configManager.detectProjectType(dir);
      assert.strictEqual(type, 'frontend');
    });

    it('should detect backend-only', async () => {
      const dir = path.join(TMP, 'be-only');
      await fs.ensureDir(path.join(dir, 'app'));
      await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "test"');
      const type = await configManager.detectProjectType(dir);
      assert.strictEqual(type, 'backend');
    });

    it('should return unknown for empty dir', async () => {
      const dir = path.join(TMP, 'empty');
      await fs.ensureDir(dir);
      const type = await configManager.detectProjectType(dir);
      assert.strictEqual(type, 'unknown');
    });
  });

  describe('copyTemplate', () => {
    it('should copy template with substitutions', async () => {
      const dest = path.join(TMP, 'output.toml');
      await configManager.copyTemplate('pyproject.template.toml', dest, {
        PROJECT_NAME: 'my-project',
      });

      const content = await fs.readFile(dest, 'utf8');
      assert.ok(content.includes('my-project'));
      assert.ok(!content.includes('{{PROJECT_NAME}}'));
    });

    it('should throw for nonexistent template', async () => {
      await assert.rejects(
        () => configManager.copyTemplate('nope.txt', path.join(TMP, 'out.txt')),
        /Template not found/
      );
    });
  });

  describe('initConfig', () => {
    it('should create config file', async () => {
      const dir = path.join(TMP, 'init-test');
      await fs.ensureDir(path.join(dir, 'frontend'));
      await fs.ensureDir(path.join(dir, 'backend'));

      const result = await configManager.initConfig(dir);
      assert.strictEqual(result.created, true);
      assert.ok(await fs.pathExists(result.path));

      const content = await fs.readFile(result.path, 'utf8');
      assert.ok(content.includes('monorepo'));
    });

    it('should not overwrite without force', async () => {
      const dir = path.join(TMP, 'init-test');
      const result = await configManager.initConfig(dir);
      assert.strictEqual(result.created, false);
    });

    it('should overwrite with force', async () => {
      const dir = path.join(TMP, 'init-test');
      const result = await configManager.initConfig(dir, { force: true });
      assert.strictEqual(result.created, true);
    });
  });

  describe('getConfig', () => {
    it('should return defaults when no config file', () => {
      const config = configManager.getConfig(path.join(TMP, 'no-config'));
      assert.strictEqual(config.frontendDir, 'frontend');
      assert.strictEqual(config.backendDir, 'backend');
      assert.strictEqual(config.srcDir, 'src');
      assert.strictEqual(config.appDir, 'app');
    });
  });
});
