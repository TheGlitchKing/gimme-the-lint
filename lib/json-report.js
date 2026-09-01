'use strict';

// Machine-readable output for `check --json`. (#18)
//
// The reporter's first run was 429 findings across two adapters, and the console
// truncates each app's list at 20 with "…and 272 more". You could see the COUNT but not
// the SHAPE — and the shape is the whole answer: 137 findings is either "137 real bugs"
// or "137 missing exemptions", and those demand opposite responses. In their case it was
// the second. Getting that answer meant bypassing the CLI entirely — hand-building a
// config, calling `gtl-contract` directly, and jq-ing the raw violations. The fastest
// path to understanding your own findings should not be "do not use the front door".
//
// Two rules govern this file.
//
// 1. NOTHING IS TRUNCATED. Truncation is a presentation decision, and this is not the
//    presentation layer. An agent handed a truncated list will reason about the visible
//    20 and baseline the rest.
//
// 2. A SKIP MUST BE VISIBLE. If this emitted only violations, an adapter that could not
//    run would serialize as an empty array — indistinguishable from a clean pass, in a
//    format specifically designed to be consumed without a human reading it. That is the
//    failure this whole tool exists to eliminate, and it is *easier* to commit in JSON
//    than on a terminal, because there is no yellow text to notice. So `skipped` is a
//    top-level array, and `ok` is never true while anything in it is non-empty to a
//    consumer that bothers to look. See principle 1.

const SCHEMA_VERSION = 1;

// Taken from the engine, never redefined here. Two copies of "what counts as
// unchecked" would eventually disagree, and the half that drifted would report a
// blind run as a clean one.
const { UNCHECKED_STATUSES: UNCHECKED } = require('./check');

function violationJson(v) {
  return {
    ruleId: v.ruleId || null,
    file: v.file || null,
    line: v.line || 0,
    col: v.col || 0,
    severity: v.severity || 'error',
    message: v.message || '',
    fingerprint: v.fingerprint || null,
    // Carried verbatim from the adapter. A consumer deciding whether `baseline` is a
    // legitimate response needs this: a defect can never be grandfathered.
    neverBaseline: v.neverBaseline === true,
  };
}

/** Serialize a runCheck() report. Returns a plain object; the caller stringifies. */
function toJson(report) {
  const units = [];
  const violations = [];
  const skipped = [];

  for (const unit of report.units || []) {
    const isUnchecked = UNCHECKED.has(unit.status);
    const found = (unit.diff && unit.diff.new) || [];

    for (const v of found) {
      violations.push({ app: unit.unit, linter: unit.linter, ...violationJson(v) });
    }

    units.push({
      app: unit.unit,
      appPath: unit.appPath || null,
      linter: unit.linter,
      status: unit.status,
      // Present whenever there is something to say about WHY. Null, not absent, so a
      // consumer can rely on the key existing.
      reason: unit.reason || null,
      checked: !isUnchecked,
      newViolations: found.length,
      baselined: (unit.diff && unit.diff.summary && unit.diff.summary.baselined) || 0,
      // A scoped run cannot tell a fixed violation from a file it never opened, so
      // staleness is only meaningful on a run that looked at everything (#26).
      staleEvaluated: Boolean(unit.diff) && !unit.partial,
    });

    if (isUnchecked) {
      skipped.push({
        app: unit.unit,
        linter: unit.linter,
        status: unit.status,
        reason: unit.reason || null,
      });
    }
  }

  return {
    schema: SCHEMA_VERSION,
    // `ok` mirrors the EXIT CODE: nothing new blocked. It is deliberately NOT
    // "everything was verified" — a run where every linter was missing is `ok: true`
    // with an exit of 0, exactly as it is on the terminal.
    //
    // Which is precisely why `allChecked` sits next to it. On a terminal a skip is a
    // yellow ⚠ line a human notices; in JSON there is nothing to notice, so a consumer
    // reading only `ok` would read "we could not look at anything" as a clean bill of
    // health. Two fields, because they are two facts.
    ok: report.ok === true,
    allChecked: skipped.length === 0,
    stage: report.stage || null,
    newViolations: report.newViolations || 0,
    staleEntries: report.staleEntries || 0,
    staleUnevaluated: Boolean(report.staleUnevaluated),
    unitCount: report.unitCount || 0,
    legacyDetected: Boolean(report.legacyDetected),
    // The whole point: flat, complete, one row per finding, app and linter on each so
    // `jq -r '.violations[].ruleId' | sort | uniq -c | sort -rn` is one step.
    violations,
    units,
    // Never fold this into `units` alone. "We could not look" has to be reachable
    // without iterating and filtering, or a consumer will not reach it.
    skipped,
  };
}

module.exports = { toJson, SCHEMA_VERSION, UNCHECKED };
