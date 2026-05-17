'use strict';

const fs = require('fs');
const path = require('path');
const { LinterAdapter } = require('./adapter');
const { createViolation, SEVERITY } = require('../violation');

// golangci-lint adapter. golangci-lint is the de-facto Go lint aggregator;
// it emits a machine-readable report under `--out-format=json`. Because the
// adapter interface and diff engine are language-agnostic, supporting Go is
// just this file — nothing in the engine changes.

const GOLANGCI_CONFIG_FILES = [
  '.golangci.yml',
  '.golangci.yaml',
  '.golangci.toml',
  '.golangci.json',
];

class GolangciLintAdapter extends LinterAdapter {
  get id() {
    return 'golangci-lint';
  }

  get languages() {
    return ['go'];
  }

  get supportsFix() {
    return true;
  }

  get manifestFiles() {
    return ['go.mod'];
  }

  get sourceExtensions() {
    return ['.go'];
  }

  configFiles() {
    return GOLANGCI_CONFIG_FILES;
  }

  buildCommand(targets, opts = {}) {
    const args = ['run', '--out-format=json'];
    if (opts.fix && this.supportsFix) args.push('--fix');

    let cwd = opts.cwd || this.projectRoot;
    let paths = targets && targets.length ? targets.slice() : ['./...'];

    // golangci-lint is Go-module aware: when pointed at a single package
    // directory, run inside it so the correct module is resolved.
    if (paths.length === 1 && paths[0] !== './...' && !paths[0].endsWith('.go')) {
      const abs = path.resolve(this.projectRoot, paths[0]);
      try {
        if (fs.statSync(abs).isDirectory()) {
          cwd = abs;
          paths = ['./...'];
        }
      } catch {
        // Not a directory — pass the target through unchanged.
      }
    }

    args.push(...paths);
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
    const issues = report && Array.isArray(report.Issues) ? report.Issues : [];

    return issues.map((issue) => {
      const pos = issue.Pos || {};
      return createViolation({
        file: this._relativize(pos.Filename || ''),
        line: pos.Line,
        col: pos.Column,
        ruleId: issue.FromLinter || 'golangci-lint',
        severity:
          String(issue.Severity).toLowerCase() === 'warning'
            ? SEVERITY.WARNING
            : SEVERITY.ERROR,
        message: issue.Text,
        source: 'golangci-lint',
      });
    });
  }
}

module.exports = GolangciLintAdapter;
