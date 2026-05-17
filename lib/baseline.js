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

/** Hash the first config file found for an adapter (unit root, then project). */
async function configHashFor(projectRoot, unitRoot, adapter) {
  for (const name of adapter.configFiles()) {
    for (const base of [unitRoot, projectRoot]) {
      const hash = await manifestManager.hashFile(path.join(base, name));
      if (hash !== 'unknown') return hash;
    }
  }
  return 'unknown';
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
      adapter = adapters.getAdapter(linterId, { projectRoot });
    } catch (err) {
      sections.push({ linter: linterId, status: 'error', reason: err.message });
      continue;
    }

    if (!adapter.detect(unit.root)) {
      sections.push({ linter: linterId, status: 'no-code' });
      continue;
    }

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
          status: baselineStore.STATUS.SKIPPED,
        })
      );
      sections.push({
        linter: linterId,
        status: 'skipped',
        reason: `${adapter.id} not installed`,
      });
      continue;
    }

    let violations = [];
    if (!opts.noBaseline) {
      try {
        violations = adapter.lint([unit.appPath], {});
      } catch (err) {
        sections.push({ linter: linterId, status: 'error', reason: err.message });
        continue;
      }
    }

    const section = baselineStore.createLinterSection(violations, {
      toolVersion: adapter.version(),
      configHash: await configHashFor(projectRoot, unit.root, adapter),
      status: opts.noBaseline ? baselineStore.STATUS.CLEAN : undefined,
    });
    baselineStore.setLinterSection(baseline, linterId, section);
    sections.push({
      linter: linterId,
      status: section.status,
      total: section.total,
      toolVersion: section.tool_version,
      configHash: section.config_hash,
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

/**
 * Create/refresh baselines for the whole project.
 * @param {string} projectRoot
 * @param {object} opts { noBaseline, strict }
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
  return { unitCount: units.length, units: results };
}

module.exports = {
  runBaseline,
  baselineUnit,
  configHashFor,
};
