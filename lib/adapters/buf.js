'use strict';

const fs = require('fs');
const path = require('path');
const { LinterAdapter, TIER, STAGE } = require('./adapter');
const { createViolation, SEVERITY } = require('../violation');
const gitRef = require('../git-ref');

// Protocol Buffers, via `buf`.
//
// TWO ADAPTERS OVER ONE BINARY, and the separation is the point:
//
//   buf          — `buf lint`.     Is this .proto well-formed and idiomatic?
//   buf-breaking — `buf breaking`. Did this commit break somebody's client?
//
// They are registered separately so they BASELINE separately, and that matters: a
// team will very reasonably carry lint debt in a large proto tree for a quarter while
// accepting exactly ZERO breaking changes. Fold them into one adapter and the only
// way to grandfather the lint debt is to grandfather the breakage too.
//
// A .proto file is the schema-first case: the file IS the source of truth, and the
// Go/Python/TypeScript structs are generated FROM it. So there is a real artifact to
// lint and a real artifact to diff, and nothing needs to be materialized.

class BufAdapter extends LinterAdapter {
  get id() {
    return 'buf';
  }

  get languages() {
    return ['protobuf'];
  }

  get supportsFix() {
    return false;
  }

  get sourceExtensions() {
    return ['.proto'];
  }

  get manifestFiles() {
    return ['buf.yaml', 'buf.work.yaml'];
  }

  get binary() {
    return this.resolveBinary([
      path.join(this.appRoot, 'node_modules', '.bin', 'buf'),
      path.join(this.projectRoot, 'node_modules', '.bin', 'buf'),
      'buf',
    ]);
  }

  configFiles() {
    return ['buf.yaml', 'buf.work.yaml'];
  }

  buildCommand(targets, opts = {}) {
    const cwd = opts.cwd || this.appRoot;
    return { cmd: this.binary, args: ['lint', '--error-format=json'], cwd };
  }

  /**
   * buf emits one JSON object PER LINE (JSON Lines), not one array. Parsing it with a
   * single JSON.parse() returns nothing and looks exactly like a clean repo.
   */
  parse(stdout) {
    const text = (stdout || '').trim();
    if (!text) return [];

    const violations = [];
    for (const line of text.split('\n')) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // not a finding — buf writes progress lines too
      }
      if (!entry.type && !entry.message) continue;

      violations.push(
        createViolation({
          file: this._relativize(entry.path || ''),
          line: entry.start_line,
          col: entry.start_column,
          ruleId: `buf/${entry.type || 'unknown'}`,
          severity: SEVERITY.ERROR,
          message: entry.message || '',
          source: 'buf',
        })
      );
    }
    return violations;
  }
}

// --- breaking changes ------------------------------------------------------------

class BufBreakingAdapter extends BufAdapter {
  get id() {
    return 'buf-breaking';
  }

  get tier() {
    return TIER.REFERENCE; // needs git HISTORY — but no network
  }

  get stage() {
    // Push, not commit. On a feature branch you may legitimately break the schema in
    // commit 3 and repair it in commit 7; blocking commit 3 would be pedantry. What
    // must never happen is the branch REACHING the base with the break still in it.
    return STAGE.PUSH;
  }

  buildCommand(targets, opts = {}) {
    const cwd = opts.cwd || this.appRoot;
    const configured = (this._config().baseRef) || null;
    const base = gitRef.resolveBaseRef(this.projectRoot, configured);

    if (!base) {
      // No history to compare against: a shallow CI clone, a detached HEAD, a fresh
      // repo. Blameless, common, and nothing to do with the code — so we skip loudly
      // rather than failing a push for a reason the developer cannot fix.
      const err = new Error(
        `buf-breaking: ${gitRef.explainMissingBase(this.projectRoot, configured)}`
      );
      err.code = 'ADAPTER_SKIPPED';
      throw err;
    }

    this._baseRef = base;

    // Git IS the snapshot. No .gtl/ copy of the schema, no second VCS in the corner
    // of a working one.
    return {
      cmd: this.binary,
      args: ['breaking', '--against', `.git#ref=${base.ref}`, '--error-format=json'],
      cwd,
    };
  }

  _config() {
    const configManager = require('../config-manager');
    const cfg = configManager.getConfig(this.projectRoot) || {};
    return cfg.buf || {};
  }

  parse(stdout) {
    const text = (stdout || '').trim();
    if (!text) return [];

    const violations = [];
    for (const line of text.split('\n')) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (!entry.type && !entry.message) continue;

      const file = this._relativize(entry.path || '');

      violations.push(
        createViolation({
          file,
          line: entry.start_line,
          col: entry.start_column,
          ruleId: `buf-breaking/${entry.type || 'unknown'}`,
          severity: SEVERITY.ERROR,
          message: entry.message || '',
          source: 'buf-breaking',
          // Identity is the ELEMENT, not the file. buf names the thing it is talking
          // about ("Field \"1\" with name \"email\" on message \"User\" was deleted"),
          // and a .proto tree gets reorganized far more often than source code does.
          // Keying on the file would evaporate the baseline on `proto/v1/` ->
          // `proto/user/v1/` and resurrect every finding it had grandfathered.
          fingerprintKey: `${entry.type || 'unknown'}:${entry.message || ''}`,
        })
      );
    }
    return violations;
  }
}

module.exports = BufAdapter;
module.exports.BufAdapter = BufAdapter;
module.exports.BufBreakingAdapter = BufBreakingAdapter;
