'use strict';

const fs = require('fs-extra');
const path = require('path');
const { fingerprint } = require('./fingerprint');

// The baseline store owns the on-disk baseline format — one shape for every
// linter and every language. A baseline file holds one section per linter so
// a single app directory can be linted by several tools (e.g. eslint + a
// formatter) and each tool's config hash and tool version are tracked
// independently. That independence is what stops a Ruff version bump from
// invalidating a JavaScript baseline.
//
// File shape (.gtl/apps/<app>/baseline.json):
// {
//   "schema": 2,
//   "created_at": "ISO-8601",
//   "linters": {
//     "eslint": {
//       "tool_version": "9.21.0",
//       "config_hash": "<md5>",
//       "status": "baselined",
//       "total": 42,
//       "fingerprints": { "<sha1>": <count> }
//     }
//   }
// }

const SCHEMA_VERSION = 2;

// Per-linter status values recorded in each section / the manifest.
//
// UNAVAILABLE and ERROR mean the baseline for that linter was NOT captured —
// they must stay distinct from CLEAN (linter ran, nothing found) and from a
// genuine empty baseline. A section in either state is an INCOMPLETE baseline:
// treating it as clean would make every pre-existing violation count as new
// the first time the linter actually runs.
const STATUS = Object.freeze({
  BASELINED: 'baselined', // violations captured into the baseline
  CLEAN: 'clean', // linter ran, found nothing to baseline
  SKIPPED: 'skipped', // intentionally not baselined (kept for back-compat)
  UNAVAILABLE: 'unavailable', // code present but the linter binary is missing
  ERROR: 'error', // the linter applies here but failed to run
});

/** True when a section's status means the baseline was not actually captured. */
function isIncompleteStatus(status) {
  return status === STATUS.UNAVAILABLE || status === STATUS.ERROR;
}

/** Build a {fingerprint: count} map from a list of NormalizedViolations. */
function buildFingerprintMap(violations) {
  const map = {};
  for (const v of violations || []) {
    const fp = fingerprint(v);
    map[fp] = (map[fp] || 0) + 1;
  }
  return map;
}

/**
 * Build a single linter section from a lint run.
 * @param {object[]} violations NormalizedViolation[]
 * @param {object} [meta]
 * @param {string} [meta.toolVersion]
 * @param {string} [meta.configHash]
 * @param {string} [meta.status] One of STATUS; defaults based on violations.
 */
function createLinterSection(violations, meta = {}) {
  const list = violations || [];
  const fingerprints = buildFingerprintMap(list);
  const status =
    meta.status || (list.length > 0 ? STATUS.BASELINED : STATUS.CLEAN);
  return {
    tool_version: meta.toolVersion || 'unknown',
    config_hash: meta.configHash || 'unknown',
    status,
    total: list.length,
    fingerprints,
  };
}

/** A fresh, empty baseline object. */
function emptyBaseline() {
  return {
    schema: SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    linters: {},
  };
}

/** Set (or replace) a linter's section on a baseline object. Mutates + returns. */
function setLinterSection(baseline, linterId, section) {
  const target = baseline || emptyBaseline();
  target.linters = target.linters || {};
  target.linters[linterId] = section;
  return target;
}

/** Read a linter's section, or null if absent. */
function getLinterSection(baseline, linterId) {
  if (!baseline || !baseline.linters) return null;
  return baseline.linters[linterId] || null;
}

/** Read a baseline file. Returns null if missing or unparseable. */
async function readBaseline(baselinePath) {
  if (!(await fs.pathExists(baselinePath))) return null;
  try {
    return await fs.readJson(baselinePath);
  } catch {
    return null;
  }
}

/** Write a baseline file, creating parent directories as needed. */
async function writeBaseline(baselinePath, baseline) {
  await fs.ensureDir(path.dirname(baselinePath));
  await fs.writeJson(baselinePath, baseline, { spaces: 2 });
}

module.exports = {
  SCHEMA_VERSION,
  STATUS,
  isIncompleteStatus,
  buildFingerprintMap,
  createLinterSection,
  emptyBaseline,
  setLinterSection,
  getLinterSection,
  readBaseline,
  writeBaseline,
};
