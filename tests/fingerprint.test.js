'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { fingerprint, normalizeMessage, normalizePath } = require('../lib/fingerprint');
const { createViolation } = require('../lib/violation');

describe('fingerprint', () => {
  it('produces a 40-char hex sha1', () => {
    const fp = fingerprint(createViolation({ file: 'a.js', ruleId: 'no-x', message: 'bad' }));
    assert.match(fp, /^[0-9a-f]{40}$/);
  });

  it('is identical for the same violation', () => {
    const v = { file: 'src/a.js', ruleId: 'no-unused-vars', message: "'x' is unused" };
    assert.strictEqual(fingerprint(v), fingerprint(v));
  });

  it('is INDEPENDENT of line and column number', () => {
    const base = { file: 'src/a.js', ruleId: 'no-unused-vars', message: "'x' is unused" };
    const moved = { ...base, line: 200, col: 9, endLine: 201 };
    assert.strictEqual(fingerprint(base), fingerprint({ ...base, line: 5, col: 1 }));
    assert.strictEqual(fingerprint(base), fingerprint(moved));
  });

  it('differs when the rule id differs', () => {
    const a = { file: 'a.js', ruleId: 'no-x', message: 'm' };
    const b = { file: 'a.js', ruleId: 'no-y', message: 'm' };
    assert.notStrictEqual(fingerprint(a), fingerprint(b));
  });

  it('differs when the file differs', () => {
    const a = { file: 'a.js', ruleId: 'no-x', message: 'm' };
    const b = { file: 'b.js', ruleId: 'no-x', message: 'm' };
    assert.notStrictEqual(fingerprint(a), fingerprint(b));
  });

  it('treats backslash and forward-slash paths as equal', () => {
    const win = { file: 'src\\nested\\a.js', ruleId: 'no-x', message: 'm' };
    const nix = { file: 'src/nested/a.js', ruleId: 'no-x', message: 'm' };
    assert.strictEqual(fingerprint(win), fingerprint(nix));
  });

  it('normalizes whitespace in the message', () => {
    const a = { file: 'a.js', ruleId: 'no-x', message: 'too   many\nspaces' };
    const b = { file: 'a.js', ruleId: 'no-x', message: 'too many spaces' };
    assert.strictEqual(fingerprint(a), fingerprint(b));
  });

  it('does not collide across field boundaries', () => {
    // "a" + "b c" must not fingerprint the same as "a b" + "c".
    const a = { file: 'a', ruleId: 'b', message: 'c' };
    const b = { file: 'a', ruleId: 'b c', message: '' };
    assert.notStrictEqual(fingerprint(a), fingerprint(b));
  });

  it('handles missing fields without throwing', () => {
    assert.match(fingerprint({}), /^[0-9a-f]{40}$/);
    assert.match(fingerprint(undefined), /^[0-9a-f]{40}$/);
  });

  describe('helpers', () => {
    it('normalizeMessage collapses and trims whitespace', () => {
      assert.strictEqual(normalizeMessage('  a\t b\n c '), 'a b c');
      assert.strictEqual(normalizeMessage(null), '');
    });

    it('normalizePath converts backslashes', () => {
      assert.strictEqual(normalizePath('a\\b\\c'), 'a/b/c');
    });
  });
});
