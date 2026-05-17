'use strict';

const fs = require('fs-extra');
const path = require('path');
const { runBaseline } = require('./baseline');

// Migration from the v1 layout (.lttf/ + .lttf-ruff/ per-directory baselines)
// to the v2 .gtl/ layout. v1 baseline files hold per-directory violation data
// in formats tied to lint-to-the-future; rather than risk converting stale
// data, migrate() backs the legacy directories up and RE-BASELINES from the
// current code — which is exactly what those baselines were meant to capture.

const LEGACY_DIR_NAMES = ['.lttf', '.lttf-ruff'];

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.gtl', 'dist', 'build', 'target',
  'vendor', '.venv', 'venv', '__pycache__', '.planning',
]);

const MAX_DEPTH = 4;

/** Find every legacy v1 baseline directory (.lttf / .lttf-ruff). */
function findLegacyDirs(projectRoot) {
  const found = [];

  function walk(absDir, relDir, depth) {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (LEGACY_DIR_NAMES.includes(entry.name)) {
        found.push(relDir ? `${relDir}/${entry.name}` : entry.name);
        continue; // do not descend into the legacy dir itself
      }
      if (IGNORE_DIRS.has(entry.name)) continue;
      walk(
        path.join(absDir, entry.name),
        relDir ? `${relDir}/${entry.name}` : entry.name,
        depth + 1
      );
    }
  }

  walk(projectRoot, '', 0);
  return found;
}

/** Detect whether a project is still on the v1 layout. */
function detectLegacy(projectRoot) {
  const root = projectRoot || process.cwd();
  const legacyDirs = findLegacyDirs(root);
  return {
    hasLegacy: legacyDirs.length > 0,
    legacyDirs,
    alreadyMigrated: fs.existsSync(path.join(root, '.gtl')),
  };
}

/**
 * Migrate a v1 project to the v2 .gtl/ layout: back the legacy directories up
 * under .gtl/legacy-backup/<timestamp>/, then re-baseline.
 * @param {string} projectRoot
 * @param {object} opts { strict }
 */
async function migrate(projectRoot, opts = {}) {
  const root = projectRoot || process.cwd();
  const legacy = detectLegacy(root);
  if (!legacy.hasLegacy) {
    return {
      migrated: false,
      reason: 'No legacy .lttf/ layout found — nothing to migrate.',
    };
  }

  // Back the legacy directories up — never delete a user's data outright.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRoot = path.join(root, '.gtl', 'legacy-backup', stamp);
  const backedUp = [];
  for (const rel of legacy.legacyDirs) {
    const src = path.join(root, rel);
    const dest = path.join(backupRoot, rel);
    await fs.ensureDir(path.dirname(dest));
    await fs.move(src, dest, { overwrite: true });
    backedUp.push(rel);
  }

  // Re-baseline from the current code into the v2 .gtl/ layout.
  const baseline = await runBaseline(root, { strict: opts.strict });

  return {
    migrated: true,
    backedUp,
    backupPath: path.relative(root, backupRoot),
    baseline,
  };
}

module.exports = {
  LEGACY_DIR_NAMES,
  findLegacyDirs,
  detectLegacy,
  migrate,
};
