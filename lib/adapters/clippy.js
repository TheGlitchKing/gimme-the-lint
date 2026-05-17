'use strict';

const fs = require('fs');
const path = require('path');
const { LinterAdapter } = require('./adapter');
const { createViolation, SEVERITY } = require('../violation');

// Clippy adapter. `cargo clippy --message-format=json` emits newline-delimited
// JSON — one record per line — rather than a single JSON document, so the
// parser walks line by line. Clippy is crate-scoped: it always lints the whole
// crate, so the adapter resolves and runs inside the crate directory.

const CLIPPY_CONFIG_FILES = ['clippy.toml', '.clippy.toml'];

class ClippyAdapter extends LinterAdapter {
  get id() {
    return 'clippy';
  }

  get languages() {
    return ['rust'];
  }

  get supportsFix() {
    return false;
  }

  get manifestFiles() {
    return ['Cargo.toml'];
  }

  get sourceExtensions() {
    return ['.rs'];
  }

  /** Clippy is invoked as a cargo subcommand. */
  get binary() {
    return 'cargo';
  }

  versionArgs() {
    return ['clippy', '--version'];
  }

  configFiles() {
    return CLIPPY_CONFIG_FILES;
  }

  buildCommand(targets, opts = {}) {
    // cargo clippy always lints the whole crate; resolve the crate directory
    // and run inside it.
    let cwd = opts.cwd || this.projectRoot;
    const first = targets && targets.length === 1 ? targets[0] : null;
    if (first && first !== '.' && !first.endsWith('.rs')) {
      const abs = path.resolve(this.projectRoot, first);
      try {
        if (fs.statSync(abs).isDirectory()) cwd = abs;
      } catch {
        // Not a directory — fall back to the default cwd.
      }
    }
    return {
      cmd: this.binary,
      args: ['clippy', '--message-format=json', '--quiet'],
      cwd,
    };
  }

  parse(stdout) {
    if (!stdout) return [];
    const violations = [];

    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let record;
      try {
        record = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (record.reason !== 'compiler-message' || !record.message) continue;

      const msg = record.message;
      // Skip the final summary and any record without a source span.
      if (!Array.isArray(msg.spans) || msg.spans.length === 0) continue;
      if (msg.level !== 'warning' && msg.level !== 'error') continue;

      const primary = msg.spans.find((s) => s.is_primary) || msg.spans[0];
      violations.push(
        createViolation({
          file: this._relativize(primary.file_name || ''),
          line: primary.line_start,
          col: primary.column_start,
          endLine: primary.line_end,
          endCol: primary.column_end,
          ruleId: (msg.code && msg.code.code) || 'clippy',
          severity: msg.level === 'error' ? SEVERITY.ERROR : SEVERITY.WARNING,
          message: msg.message,
          source: 'clippy',
        })
      );
    }
    return violations;
  }
}

module.exports = ClippyAdapter;
