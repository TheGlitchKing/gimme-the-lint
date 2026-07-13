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

/**
 * Build a {fingerprint: count} map from a list of NormalizedViolations.
 *
 * GATE 1 of 3 on un-baselineable violations. A violation flagged `neverBaseline`
 * is EXCLUDED here — at capture time — so it is not merely "discouraged" from being
 * grandfathered, it is physically absent from the file that does the
 * grandfathering. Running `baseline` deliberately, twice, with intent, will not put
 * it there.
 *
 * The distinction the flag encodes is between DEBT and a DEFECT:
 *
 *   debt   — a gap. The app works; it just has a hole in it. Grandfathering is
 *            exactly what progressive linting is FOR: the old hole stays, a new one
 *            blocks. A team adopting this on a mature codebase has hundreds, and
 *            demanding all of them be fixed before the first commit is how linters
 *            get uninstalled.
 *
 *   defect — broken right now, for everyone, regardless of what anyone does next.
 *            Grandfathering it means writing down "we accept that every read of this
 *            entity returns a 500", which nobody would say out loud. So the tool
 *            will not say it for them.
 *
 * There is still an escape hatch, and it is deliberately expensive: declare it in
 * .gtl/config.js WITH A REASON. The friction is the feature. (Precedent: gitleaks
 * findings are never baselined either — a leaked secret is not technical debt.)
 */
function buildFingerprintMap(violations) {
  const map = {};
  for (const v of violations || []) {
    if (v && v.neverBaseline) continue;
    const fp = fingerprint(v);
    map[fp] = (map[fp] || 0) + 1;
  }
  return map;
}

/** The violations a baseline run refused to capture, for loud reporting. */
function unbaselineable(violations) {
  return (violations || []).filter((v) => v && v.neverBaseline);
}

/**
 * Build a single linter section from a lint run.
 * @param {object[]} violations NormalizedViolation[]
 * @param {object} [meta]
 * @param {string} [meta.toolVersion]
 * @param {string} [meta.configHash]
 * @param {string} [meta.status] One of STATUS; defaults based on violations.
 * @param {Object<string,string>} [meta.rulesetVersions] Per-ruleset-plugin
 *   versions (e.g. tflint). A loose .tflint.hcl version constraint lets a
 *   plugin update without the config text changing, so neither config_hash
 *   nor tool_version moves — this map is what makes that rule change visible.
 */
function createLinterSection(violations, meta = {}) {
  const list = violations || [];
  const fingerprints = buildFingerprintMap(list);

  // `total` is how many violations this baseline GRANDFATHERS — not how many the
  // linter found. Those numbers differ whenever a defect was refused (see
  // buildFingerprintMap), and reporting the larger one would have the baseline
  // lying about its own contents: "15 baselined" next to a file holding 10.
  const total = Object.values(fingerprints).reduce((sum, n) => sum + n, 0);

  const status = meta.status || (total > 0 ? STATUS.BASELINED : STATUS.CLEAN);
  const section = {
    tool_version: meta.toolVersion || 'unknown',
    config_hash: meta.configHash || 'unknown',
    status,
    total,
    fingerprints,
  };
  // Only present for linters with ruleset plugins — kept off every other
  // section so the baseline format stays unchanged for them.
  if (meta.rulesetVersions && Object.keys(meta.rulesetVersions).length) {
    section.ruleset_versions = meta.rulesetVersions;
  }
  return section;
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
  unbaselineable,
  createLinterSection,
  emptyBaseline,
  setLinterSection,
  getLinterSection,
  readBaseline,
  writeBaseline,
};
