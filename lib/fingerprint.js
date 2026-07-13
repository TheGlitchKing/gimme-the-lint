'use strict';

const crypto = require('crypto');

// A violation fingerprint identifies "the same problem" across commits.
// It is DELIBERATELY independent of line/column number so that a baselined
// violation survives code moving up or down the file — only genuinely new
// problems should ever be flagged. This is the core of progressive linting
// and the job gimme-the-lint previously outsourced to lint-to-the-future.

/** Collapse whitespace so cosmetic message reflow does not change identity. */
function normalizeMessage(message) {
  return String(message == null ? '' : message)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize a path to forward slashes so OS differences do not matter. */
function normalizePath(file) {
  return String(file == null ? '' : file).replace(/\\/g, '/');
}

/**
 * Compute a stable fingerprint for a NormalizedViolation.
 *
 * Two identity schemes, chosen by whether the adapter supplied a
 * `fingerprintKey`:
 *
 *   DEFAULT (no key) — identity = relative path + rule id + normalized message.
 *   Line/column are intentionally excluded, so a baselined violation survives
 *   code moving up or down a file. This is the original scheme and it must stay
 *   BYTE-IDENTICAL forever: changing it would make every baselined violation in
 *   every repo read as new the moment they upgrade.
 *
 *   KEYED (fingerprintKey set) — identity = the key + rule id, ignoring file and
 *   message entirely. Some linters can name the thing they are complaining about
 *   with a stable, fully-qualified path of their own (`Deal.operating_expenses`,
 *   `acme.user.v1.User.email`). When they can, that is a far better identity than
 *   the file: it survives the declaration being MOVED to another file, which
 *   schemas and models undergo far more often than source code does. It also
 *   survives the message text being reworded, which matters when the message
 *   enumerates a set ("no write schema accepts [a, b, c]") and would otherwise
 *   change identity every time the set changes.
 *
 * The two schemes cannot collide: one hashes a 3-element JSON array, the other a
 * 2-element one.
 *
 * @param {object} violation NormalizedViolation
 * @returns {string} 40-char hex sha1
 */
function fingerprint(violation) {
  const v = violation || {};
  const ruleId = String(v.ruleId == null ? 'unknown' : v.ruleId);

  const parts =
    v.fingerprintKey == null || v.fingerprintKey === ''
      ? [normalizePath(v.file), ruleId, normalizeMessage(v.message)]
      : [String(v.fingerprintKey), ruleId];

  return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex');
}

module.exports = {
  fingerprint,
  normalizeMessage,
  normalizePath,
};
