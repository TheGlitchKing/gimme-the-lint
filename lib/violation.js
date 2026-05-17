'use strict';

// NormalizedViolation: the universal currency every linter adapter emits.
// Every adapter's parse() must return an array of these, so the diff engine
// and baseline store never need to know which linter produced them.

const SEVERITY = Object.freeze({
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
});

/**
 * Build a NormalizedViolation with defaults applied.
 * @param {object} props
 * @param {string} props.file    Path to the file (relative paths preferred).
 * @param {number} props.line    1-based line number.
 * @param {number} props.col     1-based column number.
 * @param {number} [props.endLine]
 * @param {number} [props.endCol]
 * @param {string} props.ruleId  Linter rule identifier (e.g. "no-unused-vars").
 * @param {string} props.severity One of SEVERITY.
 * @param {string} props.message Human-readable message.
 * @param {string} props.source  Adapter id that produced this (e.g. "eslint").
 * @returns {object} NormalizedViolation
 */
function createViolation({
  file,
  line,
  col,
  endLine,
  endCol,
  ruleId,
  severity,
  message,
  source,
} = {}) {
  return {
    file: file ? String(file) : '',
    line: Number.isFinite(line) ? line : 0,
    col: Number.isFinite(col) ? col : 0,
    endLine: Number.isFinite(endLine) ? endLine : null,
    endCol: Number.isFinite(endCol) ? endCol : null,
    ruleId: ruleId ? String(ruleId) : 'unknown',
    severity: Object.values(SEVERITY).includes(severity) ? severity : SEVERITY.ERROR,
    message: message ? String(message) : '',
    source: source ? String(source) : 'unknown',
  };
}

/** True when the violation is an error (errors block; warnings/info inform). */
function isError(violation) {
  return violation && violation.severity === SEVERITY.ERROR;
}

module.exports = {
  SEVERITY,
  createViolation,
  isError,
};
