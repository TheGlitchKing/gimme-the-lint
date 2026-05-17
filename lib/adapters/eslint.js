'use strict';

const path = require('path');
const { LinterAdapter } = require('./adapter');
const { createViolation, SEVERITY } = require('../violation');

// ESLint adapter. Parses `eslint --format=json`. With its own diff engine in
// place, gimme-the-lint no longer needs the lint-to-the-future plugin to make
// ESLint progressive — ESLint is now just one adapter among several.

const ESLINT_CONFIG_FILES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
];

class EslintAdapter extends LinterAdapter {
  get id() {
    return 'eslint';
  }

  get languages() {
    return ['javascript', 'typescript'];
  }

  get supportsFix() {
    return true;
  }

  get manifestFiles() {
    return ['package.json'];
  }

  get sourceExtensions() {
    return ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'];
  }

  /**
   * Prefer the app-local ESLint, then the repo-root ESLint, then PATH. In a
   * monorepo each JS app has its own node_modules; the repo root often has
   * none, so resolving only at projectRoot makes available() falsely return
   * false and the linter gets silently skipped.
   */
  get binary() {
    return this.resolveBinary([
      path.join(this.appRoot, 'node_modules', '.bin', 'eslint'),
      path.join(this.projectRoot, 'node_modules', '.bin', 'eslint'),
      'eslint',
    ]);
  }

  configFiles() {
    return ESLINT_CONFIG_FILES;
  }

  buildCommand(targets, opts = {}) {
    const args = ['--format=json'];
    if (opts.fix) args.push('--fix');
    // Run inside the app directory so ESLint resolves the app's own flat
    // config (eslint.config.js) — in a monorepo the repo root often has none.
    const cwd = opts.cwd || this.appRoot;
    const list = (targets && targets.length ? targets : ['.']).map((t) => {
      const rel = path.relative(cwd, path.resolve(this.projectRoot, t));
      return rel === '' ? '.' : rel;
    });
    args.push(...list);
    return { cmd: this.binary, args, cwd };
  }

  parse(stdout) {
    const text = (stdout || '').trim();
    if (!text) return [];

    let report;
    try {
      report = JSON.parse(text);
    } catch {
      // Non-JSON output (e.g. a config error) — nothing to baseline.
      return [];
    }
    if (!Array.isArray(report)) return [];

    const violations = [];
    for (const fileResult of report) {
      // ESLint emits absolute paths; relativize so fingerprints are portable.
      const relFile = this._relativize(fileResult.filePath || '');
      for (const message of fileResult.messages || []) {
        violations.push(
          createViolation({
            file: relFile,
            line: message.line,
            col: message.column,
            endLine: message.endLine,
            endCol: message.endColumn,
            ruleId: message.ruleId || (message.fatal ? 'fatal-parse-error' : 'unknown'),
            severity: message.severity === 2 ? SEVERITY.ERROR : SEVERITY.WARNING,
            message: message.message,
            source: 'eslint',
          })
        );
      }
    }
    return violations;
  }
}

module.exports = EslintAdapter;
