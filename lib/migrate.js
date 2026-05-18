'use strict';

const fs = require('fs-extra');
const path = require('path');
const { runBaseline } = require('./baseline');
const projectModel = require('./project-model');
const configManager = require('./config-manager');
const { resolveUnits } = require('./units');
const adapters = require('./adapters');
const baselineStore = require('./baseline-store');
const { fingerprint } = require('./fingerprint');
const ruleAliases = require('./rule-aliases');

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

  // Pin the discovered app/linter layout into gimme-the-lint.config.js so the
  // guess is visible and editable, not silently re-derived on every run.
  const discoveredApps = projectModel.discoverApps(root);
  const appsConfig = await configManager.writeAppsConfig(root, discoveredApps);
  const discoveryWarnings = projectModel.discoveryWarnings(root);

  // Re-baseline from the current code into the v2 .gtl/ layout.
  const baseline = await runBaseline(root, { strict: opts.strict });

  return {
    migrated: true,
    backedUp,
    backupPath: path.relative(root, backupRoot),
    discoveredApps,
    appsConfig,
    discoveryWarnings,
    baseline,
    // Incomplete linter sections (unavailable / errored) — a baseline in this
    // state never captured those linters and must not silently gate commits.
    incomplete: baseline.incomplete || [],
  };
}

/**
 * Reconcile one linter section's fingerprint map against a fresh lint run,
 * rewriting renamed rules through the alias map.
 *  - a baselined violation still occurring under the same rule  → kept
 *  - a baselined violation now occurring under a RENAMED rule    → fingerprint
 *    rewritten old→new, count (the grandfather) preserved
 *  - a baselined violation no longer occurring (fixed, or its rule removed)
 *                                                                → dropped
 *  - a genuinely new violation (occurs now, never baselined under any name)
 *                                                                → NOT added,
 *    so it still blocks
 * @returns {{fingerprints, total, renamed, dropped}}
 */
function reconcileFingerprints(baselineFps, current, aliases) {
  // newRuleId → [oldRuleId, …]
  const reverse = {};
  for (const [oldId, newId] of Object.entries(aliases)) {
    if (newId) (reverse[newId] = reverse[newId] || []).push(oldId);
  }

  const result = {};
  const renamed = [];
  const claimed = new Set();

  for (const v of current || []) {
    const fp = fingerprint(v);
    if (baselineFps[fp] != null) {
      result[fp] = baselineFps[fp];
      claimed.add(fp);
      continue;
    }
    // v.ruleId may be the NEW name of a violation baselined under an OLD name.
    for (const oldId of reverse[v.ruleId] || []) {
      const oldFp = fingerprint({ ...v, ruleId: oldId });
      if (baselineFps[oldFp] != null && !claimed.has(oldFp)) {
        result[fp] = baselineFps[oldFp];
        claimed.add(oldFp);
        renamed.push({ from: oldId, to: v.ruleId });
        break;
      }
    }
    // Unmatched current violation → genuinely new → left out of the baseline.
  }

  const dropped = [];
  for (const [fp, count] of Object.entries(baselineFps)) {
    if (!claimed.has(fp)) dropped.push({ fingerprint: fp, count });
  }

  const total = Object.values(result).reduce((sum, n) => sum + n, 0);
  return { fingerprints: result, total, renamed, dropped };
}

/**
 * Rule-rename / rule-removal migration (`migrate --rules`). Re-lints every
 * unit and rewrites its baseline fingerprints through the per-linter alias
 * map. Distinct from the v1→v2 layout migration: this touches only the
 * fingerprint maps inside existing .gtl baselines.
 * @returns {{migrated: boolean, units: object[]}}
 */
async function migrateRules(projectRoot) {
  const root = projectRoot || process.cwd();
  const units = resolveUnits(root);
  const reports = [];

  for (const unit of units) {
    const baseline = await baselineStore.readBaseline(unit.baselinePath);
    if (!baseline) continue;
    let changed = false;
    const unitReport = { app: unit.appPath, linters: [] };

    for (const linterId of unit.linters) {
      const aliases = ruleAliases.getAliases(linterId);
      if (!aliases || Object.keys(aliases).length === 0) continue;

      const section = baselineStore.getLinterSection(baseline, linterId);
      if (!section || !section.fingerprints) continue;

      let adapter;
      try {
        adapter = adapters.getAdapter(linterId, {
          projectRoot: root,
          appRoot: unit.root,
        });
      } catch {
        continue;
      }
      if (!adapter.detect(unit.root) || !adapter.available()) continue;

      let current;
      try {
        current = adapter.lint([unit.appPath], {});
      } catch {
        continue;
      }
      // A re-lint that surfaced its own failure (a synthetic *-error
      // violation) is not trustworthy ground truth — never let it drive a
      // baseline rewrite, or real grandfathered violations would be dropped.
      if (current.some((v) => /-error$/.test(v.ruleId) && !v.file)) continue;

      const rec = reconcileFingerprints(section.fingerprints, current, aliases);
      if (rec.renamed.length === 0 && rec.dropped.length === 0) continue;

      section.fingerprints = rec.fingerprints;
      section.total = rec.total;
      changed = true;
      unitReport.linters.push({
        linter: linterId,
        renamed: rec.renamed,
        dropped: rec.dropped.length,
      });
    }

    if (changed) {
      await baselineStore.writeBaseline(unit.baselinePath, baseline);
      reports.push(unitReport);
    }
  }

  return { migrated: reports.length > 0, units: reports };
}

module.exports = {
  LEGACY_DIR_NAMES,
  findLegacyDirs,
  detectLegacy,
  migrate,
  migrateRules,
  reconcileFingerprints,
};
