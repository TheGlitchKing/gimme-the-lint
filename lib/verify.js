'use strict';

const { resolveUnits } = require('./units');
const adapters = require('./adapters');
const { TIER } = require('./adapters/adapter');
const baselineStore = require('./baseline-store');
const diffEngine = require('./diff-engine');

// `verify` — the home for checks that need a database, a schema registry, or a
// network.
//
// WHY THIS IS A SEPARATE COMMAND AND NOT A FLAG ON `check`
//
// Because a flag can be passed by accident, and an invariant that depends on nobody
// passing a flag is not an invariant. Two things the engine holds on purpose:
//
//   * `check` is a git hook. It has to be hermetic and fast. A pre-commit hook that
//     dials a production database is a hook that fails on an aeroplane, hangs behind
//     a VPN, and gets uninstalled within the week.
//
//   * `--offline` is a real, supported mode. Air-gapped and regulated environments
//     are an explicit constituency, and nothing may silently require a network.
//
// So the separation is STRUCTURAL: `check` refuses external-tier adapters outright
// (check.js), and `verify` is the only door they can come through. Neither behavior
// depends on anyone remembering the rule.
//
// The mirror image also matters: under `--offline`, `verify` FAILS rather than
// skipping. A silent skip there would hide a provisioning bug — the CI job would go
// green having checked nothing, which is the failure this whole engine exists to
// prevent, dressed up as politeness.

/**
 * Run every external-tier adapter.
 * @param {string} projectRoot
 * @param {object} opts { offline, strict }
 * @returns {Promise<{ok, newViolations, units, unitCount}>}
 */
async function runVerify(projectRoot, opts = {}) {
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
      } catch {
        continue;
      }

      // `verify` runs the external adapters and ONLY the external adapters. The
      // local ones already ran on commit and push; running them again here would
      // make a red CI job ambiguous — did the contract break, or is this just the
      // lint failure you already knew about?
      if (adapter.tier !== TIER.EXTERNAL) continue;

      const base = { unit: unit.id, appPath: unit.appPath, linter: adapter.id };

      if (!adapter.detect(unit.root)) {
        results.push({ ...base, status: 'no-code' });
        continue;
      }

      // Offline means air-gapped. An external check cannot run, and pretending
      // otherwise by skipping would let a CI job report success having verified
      // nothing at all.
      if (opts.offline) {
        const err = new Error(
          `${adapter.id} needs a database or network, and --offline forbids that. ` +
            'Either provision the connection, or do not run `verify` in an air-gapped ' +
            'job — but do not let it pass having checked nothing.'
        );
        err.code = 'OFFLINE_EXTERNAL';
        throw err;
      }

      if (!adapter.available()) {
        results.push({
          ...base,
          status: 'skipped',
          reason: `${adapter.id} is not installed`,
        });
        continue;
      }

      let violations;
      try {
        violations = adapter.lint([unit.appPath], {});
      } catch (err) {
        if (err.code === 'ADAPTER_SKIPPED') {
          // We could not look. Loud, and never a pass.
          results.push({ ...base, status: 'skipped', reason: err.message });
          continue;
        }
        results.push({ ...base, status: 'error', reason: err.message });
        continue;
      }

      const baseline = await baselineStore.readBaseline(unit.baselinePath);
      const section = baselineStore.getLinterSection(baseline, adapter.id);
      const result = diffEngine.diff(violations, section);

      results.push({
        ...base,
        status: result.new.length > 0 ? 'fail' : 'pass',
        supportsFix: adapter.supportsFix,
        hasBaseline: Boolean(section),
        diff: result,
      });
    }
  }

  const newViolations = results.reduce(
    (sum, r) => sum + (r.diff ? r.diff.new.length : 0),
    0
  );

  return {
    ok: newViolations === 0,
    newViolations,
    staleEntries: 0,
    stage: 'ci',
    unitCount: results.length,
    units: results,
    legacyDetected: false,
  };
}

module.exports = { runVerify };
