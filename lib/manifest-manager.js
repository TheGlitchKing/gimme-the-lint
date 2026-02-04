'use strict';

const fs = require('fs-extra');
const crypto = require('crypto');
const path = require('path');

async function hashFile(filePath) {
  if (!await fs.pathExists(filePath)) {
    return 'unknown';
  }
  const content = await fs.readFile(filePath, 'utf8');
  return crypto.createHash('md5').update(content).digest('hex');
}

function calculateAge(createdAt) {
  const created = new Date(createdAt);
  const now = new Date();
  return Math.floor((now - created) / (1000 * 60 * 60 * 24));
}

async function createManifest({ tool, version, directories, violations, configPath, testExcluded }) {
  const configHash = await hashFile(configPath);

  return {
    created_at: new Date().toISOString(),
    tool,
    version,
    directories_baselined: directories,
    total_directories: directories.length,
    total_violations: violations,
    config_hash: configHash,
    test_excluded: testExcluded || [],
  };
}

async function readManifest(manifestPath) {
  if (!await fs.pathExists(manifestPath)) {
    return null;
  }
  try {
    return await fs.readJson(manifestPath);
  } catch {
    return null;
  }
}

async function writeManifest(manifestPath, manifest) {
  await fs.ensureDir(path.dirname(manifestPath));
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });
}

module.exports = {
  hashFile,
  calculateAge,
  createManifest,
  readManifest,
  writeManifest,
};
