'use strict';

const { execSync } = require('child_process');
const { resolveUnits } = require('./units');
const adapters = require('./adapters');
const baselineStore = require('./baseline-store');
const diffEngine = require('./diff-engine');
const { detectLegacy } = require('./migrate');

// runCheck() is the v2 progressive-lint check: for every unit/linter it runs
// the adapter, diffs the result against the unit's baseline, and reports only
// NEW violations. It is the in-house replacement for run-checks.sh's
// "fail on any violation" behavior.

/** Files staged for the current commit, relative to the project root. */
function gitStagedFiles(projectRoot) {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACMR', {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    return out ? out.split('\n') : [];
  } catch {
    return [];
  }
}

/** Which paths to hand the linter: staged files for this unit, or the app. */
function resolveTargets(projectRoot, unit, adapter, opts) {
  if (!opts.changedOnly) {
    return [unit.appPath];
  }
  const staged = gitStagedFiles(projectRoot);
  const prefix = unit.appPath === '.' ? '' : `${unit.appPath.replace(/\/$/, '')}/`;
  return staged.filter((file) => {
    if (prefix && !file.startsWith(prefix)) return false;
    return adapter.sourceExtensions.some((ext) => file.endsWith(ext));
  });
}

/** Check one unit with one adapter. Honors the idempotent-skip contract. */
async function checkUnit(projectRoot, unit, adapter, opts) {
  const base = { unit: unit.id, appPath: unit.appPath, linter: adapter.id };

  // No code for this language here → silent no-op.
  if (!adapter.detect(unit.root)) {
    return { ...base, status: 'no-code' };
  }

  // Code present but linter missing → warn+skip, unless strict mode.
  if (!adapter.available()) {
    if (opts.strict) {
      const err = new Error(
        `${adapter.id}: linter not installed, but ${unit.id} contains ` +
          `${adapter.languages.join('/')} code (strict/offline mode)`
      );
      err.code = 'LINTER_UNAVAILABLE';
      throw err;
    }
    return { ...base, status: 'skipped', reason: `${adapter.id} not installed` };
  }

  const targets = resolveTargets(projectRoot, unit, adapter, opts);
  if (opts.changedOnly && targets.length === 0) {
    return { ...base, status: 'unchanged' };
  }

  let violations;
  try {
    violations = adapter.lint(targets, { fix: opts.fix });
  } catch (err) {
    return { ...base, status: 'error', reason: err.message };
  }

  const baseline = await baselineStore.readBaseline(unit.baselinePath);
  const section = baselineStore.getLinterSection(baseline, adapter.id);

  // An incomplete baseline section (the linter was unavailable or errored when
  // the baseline was captured) is not a real baseline — diffing against its
  // empty fingerprint map would flag every pre-existing violation as new and
  // block the commit. Surface it as a warning to re-baseline instead.
  if (section && baselineStore.isIncompleteStatus(section.status)) {
    return {
      ...base,
      status: 'needs-baseline',
      reason:
        `baseline for ${adapter.id} is incomplete (was "${section.status}" ` +
        'when captured) — run: gimme-the-lint baseline',
    };
  }

  const result = diffEngine.diff(violations, section);

  return {
    ...base,
    status: result.new.length > 0 ? 'fail' : 'pass',
    hasBaseline: Boolean(section),
    diff: result,
  };
}

/**
 * Run progressive linting across every unit in the project.
 * @param {string} projectRoot
 * @param {object} opts { fix, changedOnly, strict }
 * @returns {Promise<{ok, newViolations, units, unitCount}>}
 */
async function runCheck(projectRoot, opts = {}) {
  const root = projectRoot || process.cwd();
  const units = resolveUnits(root);
  const results = [];

  for (const unit of units) {
    for (const linterId of unit.linters) {
      let adapter;
      try {
        adapter = adapters.getAdapter(linterId, {
          projectRoot: root,
          appRoot: unit.root,
        });
      } catch (err) {
        results.push({
          unit: unit.id,
          appPath: unit.appPath,
          linter: linterId,
          status: 'error',
          reason: err.message,
        });
        continue;
      }
      results.push(await checkUnit(root, unit, adapter, opts));
    }
  }

  const newViolations = results.reduce(
    (sum, r) => sum + (r.diff ? r.diff.new.length : 0),
    0
  );

  return {
    ok: newViolations === 0,
    newViolations,
    unitCount: units.length,
    units: results,
    // Surface a v1 project that has not been migrated yet.
    legacyDetected: detectLegacy(root).hasLegacy,
  };
}

module.exports = {
  runCheck,
  checkUnit,
  resolveTargets,
  gitStagedFiles,
};
