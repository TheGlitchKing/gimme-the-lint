'use strict';

const fs = require('fs');
const path = require('path');
const { LinterAdapter } = require('./adapter');
const { createViolation, SEVERITY } = require('../violation');

// tflint adapter. tflint is the de-facto Terraform/OpenTofu linter; it emits a
// machine-readable report under `--format json`. Terraform has no manifest
// file — a directory of *.tf (or *.tofu) IS the module — so detection here is
// extension-based. tflint is module-scoped: it lints the .tf files of one
// directory, so the adapter resolves and runs inside that directory, mirroring
// the crate/module handling in the Clippy and golangci-lint adapters.

const TFLINT_CONFIG_FILES = ['.tflint.hcl'];

/** Map a tflint severity string onto a NormalizedViolation severity. */
function mapSeverity(severity) {
  switch (String(severity).toLowerCase()) {
    case 'error':
      return SEVERITY.ERROR;
    case 'notice':
    case 'info':
      return SEVERITY.INFO;
    case 'warning':
    default:
      return SEVERITY.WARNING;
  }
}

class TflintAdapter extends LinterAdapter {
  get id() {
    return 'tflint';
  }

  get languages() {
    return ['terraform'];
  }

  get supportsFix() {
    return true;
  }

  // tflint config files double as a detection hint; the real signal is the
  // presence of *.tf source (see sourceExtensions / project-model.js).
  get manifestFiles() {
    return ['.tflint.hcl', '.terraform.lock.hcl'];
  }

  get sourceExtensions() {
    return ['.tf', '.tofu'];
  }

  configFiles() {
    return TFLINT_CONFIG_FILES;
  }

  buildCommand(targets, opts = {}) {
    const args = ['--format=json'];
    if (opts.fix && this.supportsFix) args.push('--fix');

    // tflint lints whichever directory it runs in. Resolve a run directory
    // from the target — a directory target directly, or the parent directory
    // of a file target (changed-files mode) — and lint there with no path
    // arguments, which keeps the adapter compatible with tflint versions that
    // predate `--chdir`.
    let cwd = opts.cwd || this.projectRoot;
    const first = targets && targets.length ? targets[0] : null;
    if (first && first !== '.') {
      const abs = path.resolve(this.projectRoot, first);
      try {
        cwd = fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
      } catch {
        // Unresolvable target — fall back to the default cwd.
      }
    }
    return { cmd: this.binary, args, cwd };
  }

  parse(stdout) {
    const text = (stdout || '').trim();
    if (!text) return [];

    let report;
    try {
      report = JSON.parse(text);
    } catch {
      return [];
    }

    const violations = [];

    const issues = Array.isArray(report.issues) ? report.issues : [];
    for (const issue of issues) {
      const range = issue.range || {};
      const start = range.start || {};
      const end = range.end || {};
      const rule = issue.rule || {};
      violations.push(
        createViolation({
          file: this._relativize(range.filename || ''),
          line: start.line,
          col: start.column,
          endLine: end.line,
          endCol: end.column,
          ruleId: rule.name || 'tflint',
          severity: mapSeverity(rule.severity),
          message: issue.message,
          source: 'tflint',
        })
      );
    }

    // tflint reports configuration / HCL parse failures in a separate
    // `errors` array — treat each as a blocking error so broken Terraform
    // fails the check rather than slipping through as zero issues.
    const errors = Array.isArray(report.errors) ? report.errors : [];
    for (const err of errors) {
      const range = err.range || {};
      const start = range.start || {};
      violations.push(
        createViolation({
          file: this._relativize(range.filename || ''),
          line: start.line,
          col: start.column,
          ruleId: 'tflint-error',
          severity: SEVERITY.ERROR,
          message: err.message || err.summary || 'tflint error',
          source: 'tflint',
        })
      );
    }

    return violations;
  }
}

module.exports = TflintAdapter;
