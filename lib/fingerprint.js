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
 * Identity = relative path + rule id + normalized message. Line/column are
 * intentionally excluded. Fields are JSON-encoded before hashing so the
 * boundaries between them are unambiguous regardless of field contents.
 * @param {object} violation NormalizedViolation
 * @returns {string} 40-char hex sha1
 */
function fingerprint(violation) {
  const v = violation || {};
  const parts = [
    normalizePath(v.file),
    String(v.ruleId == null ? 'unknown' : v.ruleId),
    normalizeMessage(v.message),
  ];
  return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex');
}

module.exports = {
  fingerprint,
  normalizeMessage,
  normalizePath,
};
