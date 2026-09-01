'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');

const { toJson } = require('../lib/json-report');

// #18. The console truncates each app's list at 20 with "…and 272 more", so a first run
// of 429 findings shows its COUNT but not its SHAPE — and the shape is the whole answer:
// 137 findings is either "137 real bugs" or "137 missing exemptions", and those demand
// opposite responses. Getting that answer meant bypassing the CLI entirely.
//
// Note the reporter's `--format json` "produced nothing" because it NEVER EXISTED —
// commander wrote "unknown option" to stderr while they were watching stdout. That is a
// missing feature, not a regression, and the last test here pins the real flag's name.

function report(overrides = {}) {
  return {
    ok: false,
    newViolations: 0,
    staleEntries: 0,
    staleUnevaluated: false,
    stage: 'push',
    unitCount: 1,
    units: [],
    legacyDetected: false,
    ...overrides,
  };
}

function unit(overrides = {}) {
  return { unit: 'backend', appPath: 'backend', linter: 'contract', status: 'failed', ...overrides };
}

function violations(n, ruleId = 'contract/column-not-writable') {
  return Array.from({ length: n }, (_, i) => ({
    ruleId,
    file: `backend/models/m${i}.py`,
    line: i + 1,
    col: 0,
    severity: 'error',
    message: `finding ${i}`,
    fingerprint: `fp${i}`,
  }));
}

function withFindings(n) {
  return report({
    newViolations: n,
    units: [unit({ diff: { new: violations(n), summary: { baselined: 3 } } })],
  });
}

test.describe('nothing is truncated', () => {
  test('every finding is emitted, far past the console limit of 20', () => {
    // The exact complaint: "…and 272 more".
    const out = toJson(withFindings(429));

    assert.strictEqual(out.violations.length, 429);
    assert.strictEqual(out.units[0].newViolations, 429);
    assert.ok(
      !JSON.stringify(out).includes('and 272 more'),
      'truncation is a presentation decision, and this is not the presentation layer'
    );
  });

  test('the flat list is what makes triage one step', () => {
    // jq -r '.violations[].ruleId' | sort | uniq -c | sort -rn
    const out = toJson(
      report({
        units: [
          unit({ diff: { new: violations(3, 'a/rule') } }),
          unit({ linter: 'openapi', diff: { new: violations(2, 'b/rule') } }),
        ],
      })
    );

    const counts = out.violations.reduce((acc, v) => {
      acc[v.ruleId] = (acc[v.ruleId] || 0) + 1;
      return acc;
    }, {});

    assert.deepStrictEqual(counts, { 'a/rule': 3, 'b/rule': 2 });
    // app and linter ride on every row, or a cross-app count needs a join.
    assert.ok(out.violations.every((v) => v.app === 'backend' && v.linter));
  });

  test('neverBaseline rides on every finding', () => {
    // A consumer deciding whether `baseline` is a legitimate response needs it: a
    // defect can never be grandfathered, and an agent that does not know that will try.
    const defect = violations(1)[0];
    const out = toJson(
      report({ units: [unit({ diff: { new: [{ ...defect, neverBaseline: true }] } })] })
    );

    assert.strictEqual(out.violations[0].neverBaseline, true);
  });
});

test.describe('a skip is not a pass — in JSON too', () => {
  // The failure is EASIER to commit in JSON than on a terminal. A skip on the terminal
  // is a yellow ⚠ a human notices; in JSON there is nothing to notice, and an adapter
  // that could not run serializes as an empty array — identical to a clean pass.
  test('a skipped adapter is reachable without iterating and filtering', () => {
    const out = toJson(
      report({
        ok: true,
        units: [unit({ status: 'skipped', reason: 'ruff not installed', linter: 'ruff' })],
      })
    );

    assert.deepStrictEqual(out.skipped, [
      { app: 'backend', linter: 'ruff', status: 'skipped', reason: 'ruff not installed' },
    ]);
  });

  test('allChecked is false whenever anything was skipped, even when ok is true', () => {
    const out = toJson(
      report({ ok: true, units: [unit({ status: 'skipped', reason: 'not installed' })] })
    );

    assert.strictEqual(out.ok, true, 'ok mirrors the exit code, and nothing NEW blocked');
    assert.strictEqual(out.allChecked, false, 'but we did not look at everything');
    assert.strictEqual(out.units[0].checked, false);
  });

  test('an errored adapter counts as unchecked, not as clean', () => {
    const out = toJson(
      report({ units: [unit({ status: 'error', reason: 'venv exploded' })] })
    );

    assert.strictEqual(out.allChecked, false);
    assert.strictEqual(out.skipped[0].reason, 'venv exploded');
  });

  test('needs-baseline is unchecked too — it diffed against nothing', () => {
    const out = toJson(report({ units: [unit({ status: 'needs-baseline' })] }));

    assert.strictEqual(out.allChecked, false);
  });

  test('a genuinely clean run says so unambiguously', () => {
    const out = toJson(
      report({ ok: true, units: [unit({ status: 'clean', diff: { new: [] } })] })
    );

    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.allChecked, true);
    assert.deepStrictEqual(out.skipped, []);
    assert.deepStrictEqual(out.violations, []);
  });

  test('"clean" and "could not look" are never the same payload', () => {
    // They are the same NUMBER of violations and opposite facts. If these two ever
    // serialize identically, the format has the disease.
    const clean = toJson(report({ ok: true, units: [unit({ status: 'clean', diff: { new: [] } })] }));
    const blind = toJson(report({ ok: true, units: [unit({ status: 'skipped', reason: 'x' })] }));

    assert.strictEqual(clean.violations.length, 0);
    assert.strictEqual(blind.violations.length, 0);
    assert.notDeepStrictEqual(clean, blind, 'same violation count, opposite facts');
  });
});

test.describe('the CLI contract', () => {
  const CLI = path.join(__dirname, '..', 'bin', 'gimme-the-lint.js');

  function run(args) {
    try {
      return { stdout: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 };
    } catch (e) {
      return { stdout: e.stdout || '', code: e.status };
    }
  }

  test('stdout carries JSON and only JSON', () => {
    // A consumer that has to strip a banner off the front is one that will eventually
    // fail to, and an unparseable report is an absent one.
    const { stdout } = run(['check', '--all', '--json']);

    const parsed = JSON.parse(stdout); // throws if a banner leaked in
    assert.strictEqual(parsed.schema, 1);
  });

  test('the flag is --json (the reporter tried --format json, which never existed)', () => {
    const { stdout, code } = run(['check', '--all', '--format', 'json']);

    assert.notStrictEqual(code, 0);
    assert.strictEqual(stdout.trim(), '', 'the error goes to stderr — which is why it looked silent');
  });
});
