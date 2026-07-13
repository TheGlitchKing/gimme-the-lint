'use strict';

const fs = require('fs');
const path = require('path');
const { LinterAdapter, TIER, STAGE } = require('./adapter');
const { createViolation, SEVERITY } = require('../violation');

// Migration SAFETY — not migration style.
//
// The bug class here is the one that only ever shows up at the worst possible moment.
// `ALTER TABLE deals ADD COLUMN notes text NOT NULL DEFAULT '';` is fine on your
// laptop, fine in CI, fine in staging with its four hundred rows — and takes an
// ACCESS EXCLUSIVE lock on a forty-million-row table in production, pinning every
// read and write behind it until it finishes. The deploy "succeeds". The site is
// down.
//
// Nothing about the SQL is malformed, so a linter that checks syntax has nothing to
// say. squawk knows which operations are dangerous AT SCALE, which is a completely
// different question, and it is the only question that matters here.
//
// Local tier: it reads .sql files. Commit stage: it is fast, and a migration is
// exactly the kind of thing you want to be told about while you are still writing it,
// not three days later at the deploy.

const SEVERITIES = {
  Warning: SEVERITY.WARNING,
  Error: SEVERITY.ERROR,
};

class SquawkAdapter extends LinterAdapter {
  get id() {
    return 'squawk';
  }

  get languages() {
    return ['sql'];
  }

  get supportsFix() {
    // There is no mechanical fix. The remedy for "this takes an exclusive lock" is to
    // rewrite the migration as a safe multi-step dance (add nullable, backfill in
    // batches, add the constraint NOT VALID, validate it separately) — a change of
    // plan, not a change of text. A tool that "fixed" this automatically would be
    // rewriting your deploy strategy without asking.
    return false;
  }

  get tier() {
    return TIER.LOCAL;
  }

  get stage() {
    return STAGE.COMMIT;
  }

  get sourceExtensions() {
    return ['.sql'];
  }

  get binary() {
    return this.resolveBinary([
      path.join(this.appRoot, 'node_modules', '.bin', 'squawk'),
      path.join(this.projectRoot, 'node_modules', '.bin', 'squawk'),
      'squawk',
    ]);
  }

  configFiles() {
    return ['.squawk.toml'];
  }

  /** Only bind where migrations actually live. Squawking at a seed file is noise. */
  detect(dir) {
    if (!dir || !fs.existsSync(dir)) return false;
    return this._migrationFiles(dir).length > 0;
  }

  /**
   * SQL files that look like migrations.
   *
   * Deliberately narrow. squawk's rules are about DANGER AT SCALE against a live
   * table, which is a meaningful question for a migration and a meaningless one for a
   * seed file, an analytics query, or a fixture. Running it on everything with a .sql
   * extension would bury the real findings in noise — and noise is what teaches people
   * to stop reading a linter.
   */
  _migrationFiles(dir) {
    const found = [];
    const walk = (absDir, depth) => {
      if (depth > 3) return;
      let entries;
      try {
        entries = fs.readdirSync(absDir, { withFileTypes: true });
      } catch {
        return;
      }
      const isMigrationDir = /migration|migrate|alembic|versions|schema/i.test(
        path.basename(absDir)
      );
      for (const entry of entries) {
        const full = path.join(absDir, entry.name);
        if (entry.isFile() && entry.name.endsWith('.sql') && isMigrationDir) {
          found.push(full);
        } else if (
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          entry.name !== 'node_modules'
        ) {
          walk(full, depth + 1);
        }
      }
    };
    walk(dir, 0);
    return found.sort();
  }

  buildCommand(targets, opts = {}) {
    const cwd = opts.cwd || this.appRoot;
    const files = this._migrationFiles(cwd);
    return { cmd: this.binary, args: ['--reporter', 'json', ...files], cwd };
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

    return report.map((r) =>
      createViolation({
        file: this._relativize(r.file || ''),
        line: r.line,
        col: r.column,
        ruleId: `squawk/${r.rule_name}`,
        severity: SEVERITIES[r.level] || SEVERITY.WARNING,
        message: r.messages
          ? r.messages.map((m) => m.Note || m.Help).filter(Boolean).join(' ')
          : r.rule_name,
        source: 'squawk',
        // Identity is the FILE plus the rule, deliberately including the file: a
        // migration is an immutable historical record, so "this migration is
        // dangerous" is a fact about that one file forever. Unlike a schema, it does
        // not get moved or refactored — and if someone writes a NEW migration with the
        // same hazard, that genuinely is a new problem.
        fingerprintKey: `${this._relativize(r.file || '')}:${r.rule_name}`,
      })
    );
  }
}

module.exports = SquawkAdapter;
