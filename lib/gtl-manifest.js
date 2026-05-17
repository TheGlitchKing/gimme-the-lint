'use strict';

const fs = require('fs-extra');
const path = require('path');
const { GTL_DIR } = require('./units');

// The global manifest (.gtl/manifest.json) is the project-wide snapshot used
// for drift detection. It records, per app and per linter, the baselined
// status, the linter version, and the config hash at baseline time. Because
// every app/linter pair is tracked independently, a Ruff version bump can
// never invalidate a JavaScript baseline — per-language manifest hashing
// falls straight out of the structure.
//
// Shape:
// {
//   "schema": 2,
//   "updated_at": "ISO-8601",
//   "apps": {
//     "apps/orders-api": {
//       "linters": {
//         "eslint": { status, tool_version, config_hash, total }
//       }
//     }
//   }
// }

const SCHEMA_VERSION = 2;

/** Absolute path to the global manifest. */
function manifestPath(projectRoot) {
  return path.join(projectRoot, GTL_DIR, 'manifest.json');
}

/** A fresh, empty global manifest. */
function emptyManifest() {
  return {
    schema: SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    apps: {},
  };
}

/** Read the global manifest, or null if missing/unparseable. */
async function readManifest(projectRoot) {
  const file = manifestPath(projectRoot);
  if (!(await fs.pathExists(file))) return null;
  try {
    return await fs.readJson(file);
  } catch {
    return null;
  }
}

/** Write the global manifest. */
async function writeManifest(projectRoot, manifest) {
  const file = manifestPath(projectRoot);
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, manifest, { spaces: 2 });
}

/**
 * Build a global manifest from runBaseline() unit results.
 * @param {object[]} unitResults Results returned by baselineUnit().
 */
function buildManifest(unitResults) {
  const manifest = emptyManifest();
  for (const unit of unitResults || []) {
    const linters = {};
    for (const section of unit.sections || []) {
      if (section.status === 'no-code') continue;
      linters[section.linter] = {
        status: section.status,
        tool_version: section.toolVersion || 'unknown',
        config_hash: section.configHash || 'unknown',
        total: section.total || 0,
      };
    }
    manifest.apps[unit.appPath] = { linters };
  }
  return manifest;
}

module.exports = {
  SCHEMA_VERSION,
  manifestPath,
  emptyManifest,
  readManifest,
  writeManifest,
  buildManifest,
};
