'use strict';

// IDENTITY FOR TYPE-CHECKER VIOLATIONS.
//
// The default fingerprint is `file + ruleId + message` (fingerprint.js), and for an
// ordinary linter that is right: ESLint's message for `no-unused-vars` is stable
// text about a stable rule.
//
// A type checker's message is not stable text. It NAMES THE TYPES:
//
//   error TS2345: Argument of type 'Prospect' is not assignable to parameter of type 'Lead'
//   error: Incompatible return value type (got "Prospect", expected "Lead")  [return-value]
//
// So renaming `Prospect` rewrites every message that mentions it. Under the default
// scheme every one of those baselined violations changes identity at once: the old
// fingerprints go stale and the new ones read as NEW. A pure rename — no behavior
// touched, nothing broken — would block the push with hundreds of violations, and
// the only practical move left is to re-baseline the whole lot, which is how a
// ratchet quietly turns back into a rubber stamp.
//
// So identity is the SHAPE of the error, not its text: the quoted type names are
// redacted out of the key while the full message is still carried on the violation
// for display. `Argument of type '…' is not assignable to parameter of type '…'` in
// a given file, with a given error code, is the same finding before and after the
// rename — which is exactly what a human would say looking at both.
//
// The trade-off, stated plainly: two errors of the same code and the same shape in
// the same file collapse to one fingerprint. The diff engine counts occurrences
// rather than testing set membership (diff-engine.js), so going from one to two
// still blocks — what is lost is the ability to tell WHICH of two identically-shaped
// errors was fixed and which was introduced. That is a real gap, and it is much
// smaller than the alternative: a baseline that dissolves on every refactor.

// Single- and double-quoted spans. tsc quotes with ', mypy with " — redact both, so
// one helper serves both adapters and a mixed-quoting message is fully covered.
const QUOTED_SPAN = /'[^']*'|"[^"]*"/g;

/** Replace quoted identifiers with a placeholder and collapse whitespace. */
function redactMessage(message) {
  return String(message == null ? '' : message)
    .replace(QUOTED_SPAN, "'…'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The fingerprintKey for a type-checker violation.
 *
 * `file` is included EXPLICITLY because the keyed scheme drops it (fingerprint.js
 * hashes `[key, ruleId]` alone). That is correct for a schema symbol like
 * `Deal.operating_expenses`, which should survive being moved to another file — but
 * wrong here: a type error is a fact about a place in a file, and the same error in
 * two files is two problems.
 */
function typecheckKey(file, code, message) {
  return `${file}::${code}::${redactMessage(message)}`;
}

module.exports = { redactMessage, typecheckKey };
