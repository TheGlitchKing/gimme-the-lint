'use strict';

const path = require('path');
const { LinterAdapter } = require('./adapter');
const { createViolation, SEVERITY } = require('../violation');

// Ruff adapter. Parses `ruff check --output-format=json`. In v1 Ruff had no
// progressive mechanism at all (the checker simply failed on any violation);
// routed through the diff engine, Ruff is now progressive like every adapter.

const RUFF_CONFIG_FILES = ['ruff.toml', '.ruff.toml', 'pyproject.toml'];

class RuffAdapter extends LinterAdapter {
  get id() {
    return 'ruff';
  }

  get languages() {
    return ['python'];
  }

  get supportsFix() {
    return true;
  }

  get manifestFiles() {
    return ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt'];
  }

  get sourceExtensions() {
    return ['.py', '.pyi'];
  }

  /** Prefer the project venv's Ruff; fall back to one on PATH. */
  get binary() {
    return this.resolveBinary([
      path.join(this.projectRoot, '.venv', 'bin', 'ruff'),
      'ruff',
    ]);
  }

  configFiles() {
    return RUFF_CONFIG_FILES;
  }

  buildCommand(targets, opts = {}) {
    const args = ['check', '--output-format=json'];
    if (opts.fix) args.push('--fix');
    const list = targets && targets.length ? targets : ['.'];
    args.push(...list);
    return { cmd: this.binary, args, cwd: opts.cwd || this.projectRoot };
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
    if (!Array.isArray(report)) return [];

    return report.map((diagnostic) => {
      const relFile = this._relativize(diagnostic.filename || '');
      const loc = diagnostic.location || {};
      const endLoc = diagnostic.end_location || {};
      return createViolation({
        file: relFile,
        line: loc.row,
        col: loc.column,
        endLine: endLoc.row,
        endCol: endLoc.column,
        // Ruff emits a null code for syntax errors; keep them distinguishable.
        ruleId: diagnostic.code || 'syntax-error',
        severity: SEVERITY.ERROR,
        message: diagnostic.message,
        source: 'ruff',
      });
    });
  }
}

module.exports = RuffAdapter;
