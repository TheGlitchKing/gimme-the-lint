'use strict';

const { execSync } = require('child_process');
const { resolveUnits } = require('./units');
const adapters = require('./adapters');
const { TIER, STAGE } = require('./adapters/adapter');
const baselineStore = require('./baseline-store');
const diffEngine = require('./diff-engine');
const { detectLegacy } = require('./migrate');

// runCheck() is the v2 progressive-lint check: for every unit/linter it runs
// the adapter, diffs the result against the unit's baseline, and reports only
// NEW violations. It is the in-house replacement for run-checks.sh's
// "fail on any violation" behavior.

// Stages are CUMULATIVE and ordered: running the `push` stage also runs
// everything that would have run at `commit`. A push should never be a weaker
// check than the commits it contains.
const STAGE_ORDER = [STAGE.COMMIT, STAGE.PUSH];

/**
 * Which stage are we running? DEFAULTS TO `commit`, and that default is a
 * SAFETY PROPERTY, not a preference.
 *
 * Git hooks are installed files: upgrading the package does not rewrite the
 * hooks already sitting in .git/hooks. An upgrading user therefore still has
 * OLD hooks that call plain `check` / `check --all` with no --stage flag. If the
 * default here were "run every stage", those stale hooks would silently begin
 * running push-stage adapters — which import the whole app — on EVERY COMMIT.
 * That is a multi-second pre-commit hook delivered as an upgrade regression, and
 * a slow hook is a hook people disable.
 *
 * Defaulting to `commit` means a stale hook degrades to "the new check does not
 * fire yet" (loud, detectable, fixed by re-running `gimme-the-lint hooks`) rather
 * than to "your commits got slow" (silent, infuriating, fixed by uninstalling).
 * Fail toward inert, never toward annoying.
 */
function stagesFor(requested) {
  const target = STAGE_ORDER.includes(requested) ? requested : STAGE.COMMIT;
  return STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(target) + 1);
}

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
  const base = {
    unit: unit.id,
    appPath: unit.appPath,
    linter: adapter.id,
    // Carried into the report so the "what do I do now" guidance can be TRUE.
    // Telling a reader (or an LLM) to run `--fix` for a linter that has no
    // autofix sends them in a circle, and the next lever they reach for is
    // `baseline` — which would grandfather the very thing that just blocked them.
    supportsFix: adapter.supportsFix,
    // The remedy when there is no autofix but the fix is still a COMMAND rather
    // than a judgement call (codegen-drift → `materialize`). Carried for the same
    // reason as supportsFix: so the guidance can be true.
    remediation: adapter.remediation,
  };

  // An `external` adapter needs a database, a registry, or a network. `check` is
  // a git hook: it must stay hermetic, fast, and runnable air-gapped. So external
  // adapters are refused here STRUCTURALLY — this is not a policy that a config
  // can loosen. They run only from `verify`. Reported rather than silently
  // dropped, so a misconfigured adapter cannot masquerade as a passing one.
  if (adapter.tier === TIER.EXTERNAL) {
    return {
      ...base,
      status: 'ci-only',
      reason: `${adapter.id} is an external-tier check (needs a database or network) — run: gimme-the-lint verify`,
    };
  }

  // Wrong stage for this run — e.g. a push-stage adapter during a pre-commit
  // check. Not a skip (nothing is wrong); it simply is not this hook's job.
  const stages = stagesFor(opts.stage);
  if (!stages.includes(adapter.stage)) {
    return { ...base, status: 'other-stage', stage: adapter.stage };
  }

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
    // An adapter may report that it could not look at all — a venv that is not
    // there, an application module that will not import. That is a SKIP, not an
    // error and emphatically not a pass: it means UNCHECKED. The engine warns
    // loudly and lets the commit through, exactly as it does for a linter that is
    // not installed. What it must never do is report zero violations and call that
    // clean, because "we found nothing" and "we could not look" are the same
    // number and opposite facts.
    if (err.code === 'ADAPTER_SKIPPED') {
      return { ...base, status: 'skipped', reason: err.message };
    }
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
    // Did this run look at the WHOLE app, or only the staged files?
    //
    // It changes what `diff.fixed` means, and only that. A baselined violation
    // missing from the results has either been fixed or was never looked at, and
    // both are the same absence — so on a scoped run `fixed` is not a finding, it
    // is a list of the files we did not open. The engine must not report it as
    // baseline slack (see runCheck).
    //
    // A whole-program adapter is exempt: it ignores `targets` and checks everything
    // even on a scoped run, so its `fixed` is honest either way.
    partial: Boolean(opts.changedOnly) && !adapter.wholeProgram,
  };
}

/**
 * Run progressive linting across every unit in the project.
 * @param {string} projectRoot
 * @param {object} opts { fix, changedOnly, strict, stage, noStaleBaseline }
 * @returns {Promise<{ok, newViolations, staleEntries, units, unitCount}>}
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

  // Baseline entries that no longer occur — the violation was fixed, but the
  // baseline still grandfathers it. The diff engine has always computed these
  // (diff-engine.js) and the checker has always thrown them away; surfacing them
  // is what turns a baseline into a RATCHET THAT ONLY SHRINKS, rather than a
  // permanent allowance that quietly re-admits a bug once someone reintroduces it.
  //
  // Reported, never fatal by default: making `--strict` fail on these would be a
  // behavior change to an existing flag, and would turn an otherwise purely
  // additive upgrade red in somebody's CI. Failing on them is opt-in via
  // `--no-stale-baseline`, and can become the default in a future major.
  //
  // ONLY COUNTED FROM RUNS THAT LOOKED AT EVERYTHING, and that qualifier is the
  // whole of issue #26. `diff()` reports every baselined fingerprint missing from
  // the current results as `fixed`, which is right for a full run and nonsense for
  // a scoped one: on a staged commit a per-file linter is handed two files, so the
  // other 99% of the baseline is "missing" merely because nobody opened it.
  //
  // Measured before the fix: 100 baselined violations, one file staged, nothing
  // actually fixed — 99 reported as stale. Every commit printed a warning that was
  // false, and `--no-stale-baseline` failed any commit that did not stage the whole
  // repo, which made the flag unusable on the hook it exists for.
  //
  // The baseline stores only {fingerprint: count} with no file, so a scoped run
  // cannot even narrow `fixed` down to the files it did read — the hashes are
  // opaque. There is nothing to salvage from a partial run; it is excluded whole.
  const evaluable = results.filter((r) => r.diff && !r.partial);
  const staleEntries = evaluable.reduce(
    (sum, r) => sum + r.diff.fixed.reduce((n, f) => n + f.count, 0),
    0
  );

  // Did we DECLINE to evaluate staleness anywhere? Needed so that asking to fail on
  // stale entries in a run that cannot detect them is loud rather than a quiet pass
  // — the difference between "checked and clean" and "never checked" is the one
  // this project exists to keep visible.
  const staleUnevaluated = results.some((r) => r.diff && r.partial);

  const ok =
    newViolations === 0 && !(opts.noStaleBaseline && staleEntries > 0);

  return {
    ok,
    newViolations,
    staleEntries,
    staleUnevaluated,
    // Echoed so the report can tell the difference between "no stale entries" and
    // "you asked about stale entries and this run could not answer".
    noStaleBaseline: Boolean(opts.noStaleBaseline),
    stage: stagesFor(opts.stage).slice(-1)[0],
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
