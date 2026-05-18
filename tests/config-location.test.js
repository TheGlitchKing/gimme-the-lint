'use strict';

// Tests for the .gtl/ config-location consolidation: gimme-the-lint's own
// config file is now canonically `.gtl/config.js` (or `.gtl/config.cjs` for
// ESM projects), with the legacy repo-root `gimme-the-lint.config.js` retained
// as a read fallback.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const configManager = require('../lib/config-manager');

const TMP = path.join(os.tmpdir(), `gimme-cfgloc-${Date.now()}`);

// Each case gets its own directory — getConfig() uses require(), which caches
// by absolute path, so distinct paths keep cases independent.
async function dir(name) {
  const d = path.join(TMP, name);
  await fs.ensureDir(d);
  return d;
}

describe('config location', () => {
  before(async () => {
    await fs.ensureDir(TMP);
  });
  after(async () => {
    await fs.remove(TMP);
  });

  describe('findConfig', () => {
    it('finds a .gtl/config.js', async () => {
      const d = await dir('gtl-js');
      await fs.outputFile(path.join(d, '.gtl', 'config.js'), 'module.exports = {};\n');
      assert.strictEqual(configManager.findConfig(d), path.join(d, '.gtl', 'config.js'));
    });

    it('finds a legacy repo-root config', async () => {
      const d = await dir('legacy');
      await fs.writeFile(path.join(d, 'gimme-the-lint.config.js'), 'module.exports = {};\n');
      assert.strictEqual(
        configManager.findConfig(d),
        path.join(d, 'gimme-the-lint.config.js')
      );
    });

    it('prefers .gtl/ over a repo-root config when both exist', async () => {
      const d = await dir('both');
      await fs.outputFile(path.join(d, '.gtl', 'config.js'), 'module.exports = {};\n');
      await fs.writeFile(path.join(d, 'gimme-the-lint.config.js'), 'module.exports = {};\n');
      assert.strictEqual(configManager.findConfig(d), path.join(d, '.gtl', 'config.js'));
    });

    it('returns null when there is no config', async () => {
      assert.strictEqual(configManager.findConfig(await dir('none')), null);
    });
  });

  describe('getConfig', () => {
    it('reads a .gtl/config.js', async () => {
      const d = await dir('read-gtl');
      await fs.outputFile(
        path.join(d, '.gtl', 'config.js'),
        "module.exports = { skipPatterns: ['from-gtl'] };\n"
      );
      assert.deepStrictEqual(configManager.getConfig(d).skipPatterns, ['from-gtl']);
    });

    it('reads a legacy repo-root config', async () => {
      const d = await dir('read-legacy');
      await fs.writeFile(
        path.join(d, 'gimme-the-lint.config.js'),
        "module.exports = { skipPatterns: ['from-root'] };\n"
      );
      assert.deepStrictEqual(configManager.getConfig(d).skipPatterns, ['from-root']);
    });

    it('uses the .gtl/ config when both locations exist', async () => {
      const d = await dir('read-both');
      await fs.outputFile(
        path.join(d, '.gtl', 'config.js'),
        "module.exports = { srcDir: 'gtl-wins' };\n"
      );
      await fs.writeFile(
        path.join(d, 'gimme-the-lint.config.js'),
        "module.exports = { srcDir: 'root-loses' };\n"
      );
      assert.strictEqual(configManager.getConfig(d).srcDir, 'gtl-wins');
    });
  });

  describe('initConfig / writeAppsConfig write to .gtl/', () => {
    it('initConfig writes a new config into .gtl/', async () => {
      const d = await dir('init');
      const result = await configManager.initConfig(d);
      assert.strictEqual(result.created, true);
      assert.strictEqual(result.path, path.join(d, '.gtl', 'config.js'));
      assert.ok(await fs.pathExists(result.path));
    });

    it('initConfig uses .cjs for an ESM project', async () => {
      const d = await dir('init-esm');
      await fs.writeJson(path.join(d, 'package.json'), { type: 'module' });
      const result = await configManager.initConfig(d);
      assert.strictEqual(result.path, path.join(d, '.gtl', 'config.cjs'));
    });

    it('initConfig does not overwrite a legacy repo-root config', async () => {
      const d = await dir('init-legacy');
      const rootCfg = path.join(d, 'gimme-the-lint.config.js');
      await fs.writeFile(rootCfg, 'module.exports = {};\n');
      const result = await configManager.initConfig(d);
      assert.strictEqual(result.created, false);
      assert.strictEqual(result.path, rootCfg);
    });

    it('writeAppsConfig writes the apps map into .gtl/', async () => {
      const d = await dir('apps');
      const result = await configManager.writeAppsConfig(d, [
        { appPath: 'web', linters: ['eslint'] },
      ]);
      assert.strictEqual(result.created, true);
      assert.strictEqual(result.path, path.join(d, '.gtl', 'config.js'));
      assert.deepStrictEqual(require(result.path).apps.web, { linters: ['eslint'] });
    });
  });
});
