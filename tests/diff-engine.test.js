'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { diff, hasNewViolations, countByFingerprint } = require('../lib/diff-engine');
const { buildFingerprintMap, createLinterSection } = require('../lib/baseline-store');
const { createViolation } = require('../lib/violation');

// Helper: a violation with sensible defaults.
function v(props) {
  return createViolation({ source: 'eslint', severity: 'error', ...props });
}

describe('diff-engine', () => {
  it('suppresses a pre-existing (baselined) violation', () => {
    const violations = [v({ file: 'a.js', line: 10, ruleId: 'no-x', message: 'bad x' })];
    const baseline = buildFingerprintMap(violations);
    const result = diff(violations, baseline);
    assert.strictEqual(result.new.length, 0);
    assert.strictEqual(result.baselined.length, 1);
    assert.strictEqual(hasNewViolations(result), false);
  });

  it('flags a brand-new violation absent from the baseline', () => {
    const baseline = buildFingerprintMap([
      v({ file: 'a.js', ruleId: 'no-x', message: 'bad x' }),
    ]);
    const current = [
      v({ file: 'a.js', ruleId: 'no-x', message: 'bad x' }),
      v({ file: 'a.js', ruleId: 'no-y', message: 'bad y' }),
    ];
    const result = diff(current, baseline);
    assert.strictEqual(result.new.length, 1);
    assert.strictEqual(result.new[0].ruleId, 'no-y');
    assert.strictEqual(result.baselined.length, 1);
    assert.strictEqual(hasNewViolations(result), true);
  });

  it('keeps a violation suppressed after a 20-line code shift', () => {
    const original = [v({ file: 'a.js', line: 12, ruleId: 'no-x', message: 'bad x' })];
    const baseline = buildFingerprintMap(original);
    // Same violation, code moved down 20 lines.
    const shifted = [v({ file: 'a.js', line: 32, col: 4, ruleId: 'no-x', message: 'bad x' })];
    const result = diff(shifted, baseline);
    assert.strictEqual(result.new.length, 0, 'line shift must not create a new violation');
    assert.strictEqual(result.baselined.length, 1);
  });

  it('counts duplicates: a second identical violation is new', () => {
    // Baseline has the violation once; the file now has it twice.
    const baseline = buildFingerprintMap([
      v({ file: 'a.js', ruleId: 'no-x', message: 'bad x' }),
    ]);
    const current = [
      v({ file: 'a.js', line: 1, ruleId: 'no-x', message: 'bad x' }),
      v({ file: 'a.js', line: 9, ruleId: 'no-x', message: 'bad x' }),
    ];
    const result = diff(current, baseline);
    assert.strictEqual(result.baselined.length, 1);
    assert.strictEqual(result.new.length, 1);
  });

  it('reports fixed violations when occurrences drop', () => {
    const baseline = buildFingerprintMap([
      v({ file: 'a.js', line: 1, ruleId: 'no-x', message: 'bad x' }),
      v({ file: 'a.js', line: 2, ruleId: 'no-x', message: 'bad x' }),
    ]);
    // Only one of the two remains.
    const current = [v({ file: 'a.js', line: 1, ruleId: 'no-x', message: 'bad x' })];
    const result = diff(current, baseline);
    assert.strictEqual(result.new.length, 0);
    assert.strictEqual(result.summary.fixed, 1);
    assert.strictEqual(result.fixed.length, 1);
    assert.strictEqual(result.fixed[0].count, 1);
  });

  it('reports a fully fixed violation', () => {
    const baseline = buildFingerprintMap([
      v({ file: 'a.js', ruleId: 'no-x', message: 'bad x' }),
    ]);
    const result = diff([], baseline);
    assert.strictEqual(result.summary.fixed, 1);
  });

  it('treats a null/empty baseline as "everything is new"', () => {
    const current = [
      v({ file: 'a.js', ruleId: 'no-x', message: 'bad x' }),
      v({ file: 'b.js', ruleId: 'no-y', message: 'bad y' }),
    ];
    assert.strictEqual(diff(current, null).new.length, 2);
    assert.strictEqual(diff(current, undefined).new.length, 2);
    assert.strictEqual(diff(current, {}).new.length, 2);
  });

  it('accepts a linter section as the baseline argument', () => {
    const section = createLinterSection([
      v({ file: 'a.js', ruleId: 'no-x', message: 'bad x' }),
    ]);
    const result = diff([v({ file: 'a.js', ruleId: 'no-x', message: 'bad x' })], section);
    assert.strictEqual(result.new.length, 0);
    assert.strictEqual(result.baselined.length, 1);
  });

  it('accepts a Map as the baseline argument', () => {
    const current = [v({ file: 'a.js', ruleId: 'no-x', message: 'bad x' })];
    const result = diff(current, countByFingerprint(current));
    assert.strictEqual(result.new.length, 0);
  });

  it('produces an accurate summary', () => {
    const baseline = buildFingerprintMap([
      v({ file: 'a.js', ruleId: 'old', message: 'old one' }),
    ]);
    const current = [
      v({ file: 'a.js', ruleId: 'old', message: 'old one' }),
      v({ file: 'a.js', ruleId: 'new', message: 'new one' }),
    ];
    const result = diff(current, baseline);
    assert.deepStrictEqual(result.summary, { total: 2, new: 1, baselined: 1, fixed: 0 });
  });

  it('handles empty current and empty baseline', () => {
    const result = diff([], {});
    assert.strictEqual(result.new.length, 0);
    assert.strictEqual(result.baselined.length, 0);
    assert.strictEqual(result.summary.total, 0);
  });
});
