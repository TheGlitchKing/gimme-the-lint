'use strict';

const path = require('path');
const { resolveUnits } = require('./units');
const adapters = require('./adapters');
const baselineStore = require('./baseline-store');
const manifestManager = require('./manifest-manager');
const gtlManifest = require('./gtl-manifest');

// runBaseline() captures the current violations for every unit/linter into
// .gtl/apps/<app>/baseline.json. After this, only NEW violations block.
// With opts.noBaseline it writes an EMPTY baseline instead — the greenfield
// "strict from day one" stance (Phase 5).
//
// A linter that is unavailable or errors out is recorded with an INCOMPLETE
// status (unavailable / error), never as a clean baseline — see baseline-store
// STATUS. runBaseline() surfaces these in `incomplete` so callers (migrate,
// the baseline CLI, the hooks installer) can refuse to gate commits against a
// baseline that never actually captured a linter.

/**
 * Hash the EFFECTIVE config file for an adapter. Resolution walks up from the
 * unit dir to the project root via the adapter's shared resolver, so the
 * hashed config is exactly the one the linter is invoked with — a repo-root
 * config governing nested units is hashed correctly, never missed or faked.
 */
// eslint-disable-next-line no-unused-vars
async function configHashFor(projectRoot, unitRoot, adapter) {
  const configPath = adapter.resolveConfigPath(unitRoot);
  if (!configPath) return 'unknown';
  return manifestManager.hashFile(configPath);
}

/** Baseline a single unit across all its bound linters. */
async function baselineUnit(projectRoot, unit, opts = {}) {
  const baseline =
    (await baselineStore.readBaseline(unit.baselinePath)) ||
    baselineStore.emptyBaseline();
  const sections = [];

  for (const linterId of unit.linters) {
    let adapter;
    try {
      adapter = adapters.getAdapter(linterId, {
        projectRoot,
        appRoot: unit.root,
      });
    } catch (err) {
      sections.push({ linter: linterId, status: 'error', reason: err.message });
      continue;
    }

    if (!adapter.detect(unit.root)) {
      sections.push({ linter: linterId, status: 'no-code' });
      continue;
    }

    // Code is present but the linter binary is missing. Under strict/offline
    // this is a hard failure; otherwise record an UNAVAILABLE section — NOT a
    // clean one — so downstream knows this baseline was never captured.
    if (!adapter.available()) {
      if (opts.strict) {
        const err = new Error(
          `${adapter.id}: linter not installed (strict/offline mode)`
        );
        err.code = 'LINTER_UNAVAILABLE';
        throw err;
      }
      baselineStore.setLinterSection(
        baseline,
        linterId,
        baselineStore.createLinterSection([], {
          status: baselineStore.STATUS.UNAVAILABLE,
        })
      );
      sections.push({
        linter: linterId,
        status: baselineStore.STATUS.UNAVAILABLE,
        reason: `${adapter.id} is not installed`,
      });
      continue;
    }

    let violations = [];
    if (!opts.noBaseline) {
      try {
        violations = adapter.lint([unit.appPath], {});
      } catch (err) {
        // The linter applies here but could not run — record an ERROR section
        // rather than leaving the baseline silently without this linter.
        baselineStore.setLinterSection(
          baseline,
          linterId,
          baselineStore.createLinterSection([], {
            status: baselineStore.STATUS.ERROR,
          })
        );
        sections.push({
          linter: linterId,
          status: baselineStore.STATUS.ERROR,
          reason: err.message,
        });
        continue;
      }
    }

    // Ruleset-plugin versions, when the adapter tracks them (e.g. tflint).
    const rulesetVersions =
      typeof adapter.rulesetVersions === 'function'
        ? adapter.rulesetVersions()
        : undefined;

    const section = baselineStore.createLinterSection(violations, {
      toolVersion: adapter.version(),
      configHash: await configHashFor(projectRoot, unit.root, adapter),
      rulesetVersions,
      status: opts.noBaseline ? baselineStore.STATUS.CLEAN : undefined,
    });
    baselineStore.setLinterSection(baseline, linterId, section);
    sections.push({
      linter: linterId,
      status: section.status,
      total: section.total,
      toolVersion: section.tool_version,
      configHash: section.config_hash,
      rulesetVersions: section.ruleset_versions,
    });
  }

  await baselineStore.writeBaseline(unit.baselinePath, baseline);
  return {
    unit: unit.id,
    appPath: unit.appPath,
    baselinePath: unit.baselinePath,
    sections,
  };
}

/** Collect every incomplete (unavailable/errored) section from unit results. */
function collectIncomplete(unitResults) {
  const incomplete = [];
  for (const u of unitResults || []) {
    for (const s of u.sections || []) {
      if (baselineStore.isIncompleteStatus(s.status)) {
        incomplete.push({
          app: u.appPath,
          linter: s.linter,
          status: s.status,
          reason: s.reason,
        });
      }
    }
  }
  return incomplete;
}

/**
 * Create/refresh baselines for the whole project.
 * @param {string} projectRoot
 * @param {object} opts { noBaseline, strict }
 * @returns {{unitCount, units, incomplete}}
 */
async function runBaseline(projectRoot, opts = {}) {
  const root = projectRoot || process.cwd();
  const units = resolveUnits(root);
  const results = [];
  for (const unit of units) {
    results.push(await baselineUnit(root, unit, opts));
  }
  // Refresh the global manifest so drift detection has a current snapshot.
  await gtlManifest.writeManifest(root, gtlManifest.buildManifest(results));
  return {
    unitCount: units.length,
    units: results,
    incomplete: collectIncomplete(results),
  };
}

/**
 * Scan committed baselines for incomplete (unavailable/errored) linter
 * sections. Used by the hooks installer to refuse to gate commits against a
 * baseline that never captured a linter.
 * @returns {Promise<{app, linter, status}[]>}
 */
async function findIncompleteBaselines(projectRoot) {
  const root = projectRoot || process.cwd();
  const out = [];
  for (const unit of resolveUnits(root)) {
    const baseline = await baselineStore.readBaseline(unit.baselinePath);
    if (!baseline || !baseline.linters) continue;
    for (const [linterId, section] of Object.entries(baseline.linters)) {
      if (baselineStore.isIncompleteStatus(section && section.status)) {
        out.push({ app: unit.appPath, linter: linterId, status: section.status });
      }
    }
  }
  return out;
}

module.exports = {
  runBaseline,
  baselineUnit,
  configHashFor,
  collectIncomplete,
  findIncompleteBaselines,
};
