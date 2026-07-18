'use strict';

const test = require('node:test');
const assert = require('node:assert');

const diffEngine = require('../lib/diff-engine');
const { createViolation } = require('../lib/violation');
const { formatCheckReport } = require('../lib/report');

// A baseline entry that no longer occurs is SLACK: the baseline permits a
// violation the code no longer commits. Left alone, it silently re-admits that
// violation the moment someone reintroduces it — a grandfathered bug quietly
// waiting to come back.
//
// The diff engine has always computed these (`fixed`); the checker has always
// thrown them away. Surfacing them is what turns a baseline into a ratchet that
// only shrinks.
//
// They are REPORTED, never fatal by default. Making `--strict` fail on them would
// be a behavior change to an existing flag: an upgrading user with a slightly
// stale baseline would find their CI red on an otherwise purely additive release.
// Failing is opt-in via `--no-stale-baseline`.

function report(overrides = {}) {
  return {
    ok: true,
    newViolations: 0,
    staleEntries: 0,
    stage: 'commit',
    unitCount: 1,
    units: [],
    legacyDetected: false,
    ...overrides,
  };
}

test.describe('diff engine surfaces stale baseline entries', () => {
  test('a fixed violation shows up as fixed', () => {
    const v = createViolation({ file: 'a.js', ruleId: 'r', message: 'm' });
    const baseline = { [require('../lib/fingerprint').fingerprint(v)]: 1 };

    const result = diffEngine.diff([], baseline);

    assert.strictEqual(result.fixed.length, 1);
    assert.strictEqual(result.fixed[0].count, 1);
    assert.strictEqual(result.summary.fixed, 1);
  });

  test('partially fixed: 3 baselined, 1 remaining → 2 stale', () => {
    const v = createViolation({ file: 'a.js', ruleId: 'r', message: 'm' });
    const fp = require('../lib/fingerprint').fingerprint(v);

    const result = diffEngine.diff([v], { [fp]: 3 });

    assert.strictEqual(result.new.length, 0);
    assert.strictEqual(result.baselined.length, 1);
    assert.strictEqual(result.fixed[0].count, 2);
  });
});

test.describe('reporting', () => {
  test('stale entries are reported', () => {
    const out = formatCheckReport(report({ staleEntries: 4 }));
    assert.match(out, /4 baseline entr/);
    assert.match(out, /gimme-the-lint baseline/);
  });

  test('no stale entries → no noise', () => {
    const out = formatCheckReport(report({ staleEntries: 0 }));
    assert.doesNotMatch(out, /baseline entr/);
  });

  test('stale entries alone do NOT block — the check still passes', () => {
    const out = formatCheckReport(report({ staleEntries: 9, ok: true }));
    assert.match(out, /All checks passed/);
  });
});

// The "report guidance" block that used to live here now has its own file:
// tests/report-guidance.test.js. It grew past a footnote when the guidance stopped
// being one boolean for the whole run — and its last test here ("if ANY failure is
// fixable, --fix is still worth suggesting") asserted the behavior that turned out
// to be the bug.

test.describe('blocking language matches the hook that is running', () => {
  test('commit stage says "Commit blocked"', () => {
    const out = formatCheckReport(
      report({
        ok: false,
        newViolations: 1,
        stage: 'commit',
        units: [{ unit: 'root', linter: 'eslint', supportsFix: true, status: 'fail', diff: { new: [1], baselined: [], fixed: [] } }],
      })
    );
    assert.match(out, /Commit blocked/);
  });

  test('push stage says "Push blocked" — telling someone their commit is blocked when it is not is just confusing', () => {
    const out = formatCheckReport(
      report({
        ok: false,
        newViolations: 1,
        stage: 'push',
        units: [{ unit: 'root', linter: 'contract', supportsFix: false, status: 'fail', diff: { new: [1], baselined: [], fixed: [] } }],
      })
    );
    assert.match(out, /Push blocked/);
    assert.doesNotMatch(out, /Commit blocked/);
  });
});
