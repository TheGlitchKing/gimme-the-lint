'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #23. Committing the lockfile moves every `example` value in your schemas from "a
// string in a Python file" into "a committed artifact a secret scanner walks" — and a
// scanner cannot tell a fake JWT from a real one. On the reporting codebase gitleaks
// failed the adoption PR on `generic-api-key`, twice, on the same fake reset token.
//
// The finding is correct: there ARE credential-shaped strings in the source. But
// discovering it as a red build on the adoption PR is a bad first impression, and the
// tempting fix — allowlist openapi.json — permanently blinds the scanner to the one file
// that mirrors the entire API surface.
//
// So `materialize` says it once, at the only moment it helps.

const ROOT = path.join(__dirname, '..');
const CLI = fs.readFileSync(path.join(ROOT, 'bin', 'gimme-the-lint.js'), 'utf8');

test.describe('the warning fires at the right moment, and only then', () => {
  test('it is gated on a FIRST-TIME write, not every materialize', () => {
    // Saying it on every refresh is noise, and noise is how people learn to skip
    // output they should be reading.
    assert.match(CLI, /existing === null && \/"examples\?"/);
  });

  test('it is gated on the document actually carrying examples', () => {
    // A repo with no examples has no problem, and a warning it cannot act on teaches
    // it to ignore the next one.
    assert.match(CLI, /"examples\?"\\s\*:/);
  });

  test('the example-detecting regex matches a real emitted document', () => {
    // The gate is a regex over generated JSON. If it stops matching what FastAPI
    // emits, the warning silently never fires — so it is checked against the shape
    // rather than trusted.
    const RE = /"examples?"\s*:/;

    assert.ok(RE.test('{"reset_token":{"type":"string","example":"eyJhbGci"}}'));
    assert.ok(RE.test('{"reset_token":{"type":"string","examples":["eyJhbGci"]}}'));
    assert.ok(RE.test('{"a": {\n  "example" : "x"\n}}'), 'whitespace before the colon');
    assert.ok(!RE.test('{"description":"an example of usage"}'), 'prose is not a field');
  });
});

test.describe('it says the thing that actually prevents the damage', () => {
  test('it tells you NOT to allowlist the lockfile', () => {
    // The tempting fix, and the one that turns a loud finding into a permanent blind
    // spot — a guard reporting green while guarding nothing.
    assert.match(CLI, /Do NOT allowlist the lockfile/);
  });

  test('it points at the source, which is where the fix belongs', () => {
    assert.match(CLI, /Fix the examples at the source/);
  });
});

test.describe('the shipped gitleaks config does not exempt the lockfile', () => {
  // A whole-file exemption here would be the single worst line in the product: the
  // lockfile mirrors every schema, so blinding the scanner to it blinds it to every
  // credential that ever lands in a default, an example, or a description.
  const template = fs.readFileSync(
    path.join(ROOT, 'templates', '.gitleaks.template.toml'),
    'utf8'
  );

  test('openapi.json is not in the allowlist paths', () => {
    assert.ok(!/openapi/i.test(template), 'the lockfile must never be allowlisted');
  });

  test('the allowlist still exists for the narrow cases it is for', () => {
    // Not an argument against allowlists — an argument against THIS one. Stopwords and
    // path rules for fixtures and templates are the right granularity.
    assert.match(template, /\[allowlist\]/);
    assert.match(template, /stopwords/);
  });
});
