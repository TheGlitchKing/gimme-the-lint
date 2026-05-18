'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const manifestManager = require('../lib/manifest-manager');

const TMP = path.join(os.tmpdir(), `gimme-test-mm-${Date.now()}`);

// manifest-manager is retained only for hashFile() — the v1 manifest functions
// were removed (superseded by gtl-manifest.js / drift.js).
describe('manifest-manager.hashFile', () => {
  before(async () => {
    await fs.ensureDir(TMP);
    await fs.writeFile(path.join(TMP, 'eslint.config.js'), 'module.exports = {};');
  });

  after(async () => {
    await fs.remove(TMP);
  });

  it('returns an md5 hash of file contents', async () => {
    const hash = await manifestManager.hashFile(path.join(TMP, 'eslint.config.js'));
    assert.strictEqual(typeof hash, 'string');
    assert.strictEqual(hash.length, 32); // MD5 hex is 32 chars
  });

  it('returns "unknown" for a nonexistent file', async () => {
    const hash = await manifestManager.hashFile(path.join(TMP, 'nope.js'));
    assert.strictEqual(hash, 'unknown');
  });

  it('returns different hashes for different content', async () => {
    await fs.writeFile(path.join(TMP, 'a.js'), 'aaa');
    await fs.writeFile(path.join(TMP, 'b.js'), 'bbb');
    const hashA = await manifestManager.hashFile(path.join(TMP, 'a.js'));
    const hashB = await manifestManager.hashFile(path.join(TMP, 'b.js'));
    assert.notStrictEqual(hashA, hashB);
  });
});
