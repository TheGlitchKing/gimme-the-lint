'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createViolation } = require('../lib/violation');
const { formatCheckReport } = require('../lib/report');

// WHAT THE FAILURE TELLS YOU TO DO NEXT.
//
// This is a safety surface, not cosmetics. The reader of a blocked run is
// increasingly an agent, and an agent does what the output says. So the output must
// never tell it to do something that cannot work — because the lever it reaches for
// when the suggested one no-ops is `baseline`, which GRANDFATHERS the finding and
// exits 0. The bug ships, and the run reports success.
//
// Three classes of finding, three different next actions:
//   fixable    — `check --fix` repairs it            (eslint, ruff, ...)
//   remediable — a command regenerates it            (codegen-drift → materialize)
//   manual     — a human must decide                 (contract, openapi, squawk)
//
// The rule these tests exist to hold: guidance is derived PER CLASS. It must never
// collapse to one verdict for the run, because a single run routinely carries more
// than one class — `--stage=push` runs every commit-stage adapter too.

function report(overrides = {}) {
  return {
    ok: false,
    newViolations: 1,
    staleEntries: 0,
    stage: 'commit',
    unitCount: 1,
    units: [],
    legacyDetected: false,
    ...overrides,
  };
}

/** A failing unit. `remediation` present ⇒ remediable; absent + !fix ⇒ manual. */
const failing = (supportsFix, linter, remediation = null) => ({
  unit: 'root',
  appPath: '.',
  linter,
  supportsFix,
  remediation,
  status: 'fail',
  hasBaseline: true,
  diff: {
    new: [createViolation({ file: 'a.py', ruleId: 'x', message: 'm' })],
    baselined: [],
    fixed: [],
  },
});

test.describe('guidance is derived from the adapters that actually failed', () => {
  test('all-fixable → the blanket auto-fix instruction, which is correct here', () => {
    const out = formatCheckReport(report({ units: [failing(true, 'eslint')] }));
    assert.match(out, /check --fix/);
    assert.match(out, /AUTOMATICALLY run/);
  });

  test('none-fixable → forbids both --fix and baseline', () => {
    const out = formatCheckReport(report({ units: [failing(false, 'contract')] }));
    assert.match(out, /no autofix/i);
    assert.match(out, /Do NOT run --fix/);
    assert.match(out, /Do NOT run `gimme-the-lint baseline`/);
    assert.match(out, /grandfathers/);
    assert.doesNotMatch(out, /AUTOMATICALLY run/);
  });
});

test.describe('MIXED runs: the blanket instruction must never escape its scope', () => {
  // The regression this file was written for. Reported from a 429-finding adoption
  // run: `check --all --stage=push` failed ESLint AND the contract check, and the
  // report told the agent to auto-fix EVERYTHING. `--fix` cannot touch a contract
  // finding, so the agent's next move was `baseline` — over a tenancy-column finding
  // whose "obvious fix" opens cross-tenant writes.
  const mixed = report({
    newViolations: 2,
    units: [failing(true, 'eslint'), failing(false, 'contract')],
  });

  test('--fix is still offered — it does fix the ESLint half', () => {
    assert.match(formatCheckReport(mixed), /check --fix/);
  });

  test('but NEVER as the unqualified "AUTOMATICALLY run" instruction', () => {
    // The exact string an agent acts on. With a non-fixable finding in the same
    // report it must not appear at all; the scoped form replaces it.
    assert.doesNotMatch(formatCheckReport(mixed), /AUTOMATICALLY run/);
  });

  test('the --fix instruction names the adapters it covers', () => {
    const out = formatCheckReport(mixed);
    assert.match(out, /For eslint ONLY/);
  });

  test('and the correctness half still gets its full warning', () => {
    const out = formatCheckReport(mixed);
    assert.match(out, /contract: CORRECTNESS findings/);
    assert.match(out, /Do NOT run `gimme-the-lint baseline`/);
    assert.match(out, /grandfathers/);
  });

  test('the do-not-baseline warning names only the non-fixable adapters', () => {
    // Naming eslint here would be false — its findings ARE autofixable, and a
    // reader who believes the whole run is unfixable stops running --fix at all.
    const out = formatCheckReport(mixed);
    assert.doesNotMatch(out, /eslint: CORRECTNESS/);
  });
});

test.describe('remediable: a command fixes it, so do not say "fix it by hand"', () => {
  const codegen = report({
    units: [failing(false, 'codegen-drift', 'gimme-the-lint materialize')],
  });

  test('the remedy command is printed', () => {
    assert.match(formatCheckReport(codegen), /gimme-the-lint materialize/);
  });

  test('an LLM is told to run it and commit the result', () => {
    const out = formatCheckReport(codegen);
    assert.match(out, /run `gimme-the-lint materialize`/);
    assert.match(out, /commit the regenerated file/);
  });

  test('and explicitly told NOT to hand-edit the generated file', () => {
    // The failure this prevents: an agent "fixes" api-types.ts by hand, the next
    // materialize overwrites it, and the drift returns with the edit lost.
    assert.match(formatCheckReport(codegen), /Do NOT hand-edit/);
  });

  test('it is NOT lumped in with hand-fix findings', () => {
    // codegen-drift has no autofix, but "fix it by hand" is the wrong advice: the
    // file is generated. Under the old boolean it fell into exactly that branch.
    assert.doesNotMatch(formatCheckReport(codegen), /codegen-drift has no autofix/);
  });

  test('all three classes at once keeps each one distinct', () => {
    const out = formatCheckReport(
      report({
        newViolations: 3,
        units: [
          failing(true, 'eslint'),
          failing(false, 'codegen-drift', 'gimme-the-lint materialize'),
          failing(false, 'contract'),
        ],
      })
    );
    assert.match(out, /For eslint ONLY/);
    assert.match(out, /run `gimme-the-lint materialize`/);
    assert.match(out, /contract: CORRECTNESS findings/);
    assert.doesNotMatch(out, /AUTOMATICALLY run/);
  });
});
