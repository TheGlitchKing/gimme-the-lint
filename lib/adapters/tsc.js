'use strict';

const fs = require('fs');
const path = require('path');
const { LinterAdapter, TIER, STAGE } = require('./adapter');
const { createViolation, SEVERITY } = require('../violation');
const { typecheckKey } = require('./typecheck-identity');

// TypeScript adapter. Parses `tsc --noEmit --pretty false`.
//
// THIS ADAPTER IGNORES `targets`, AND THAT IS THE POINT.
//
// Every other adapter lints the files it is handed; at commit time that is the
// staged set. A type checker cannot work that way. It is WHOLE-PROGRAM: the type of
// an expression in file A depends on declarations in files B and C, so checking A
// alone is not a cheaper version of the same question, it is a different and much
// weaker one. Worse, the errors a change causes usually are not IN the changed file
// — rename a method's return type and the breakage lands in every caller, none of
// which the commit touched. Handing tsc only the staged files would report those
// callers as clean, which is the silent-pass failure this engine exists to prevent.
//
// So it always checks the whole project, and the engine's diff does the rest: the
// full error set is compared against the full baseline (diff-engine.js compares sets,
// not scopes), so a caller broken in an untouched file shows up as NEW. No engine
// change was needed for this — see .planning/ notes.
//
// The cost is that it is slow, which is what `stage: push` is for.

const TSCONFIG_FILES = ['tsconfig.json'];

// `path/to/file.ts(12,5): error TS2345: message`
const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/;
// Project-level errors carry no file: `error TS18003: No inputs were found...`
const GLOBAL_DIAGNOSTIC = /^(error|warning)\s+(TS\d+):\s+(.*)$/;

class TscAdapter extends LinterAdapter {
  get id() {
    return 'tsc';
  }

  get languages() {
    return ['typescript'];
  }

  /**
   * `tsc` has no autofix and never will — a type error is a statement that the code
   * means something other than what it says, and no tool can know which half is wrong.
   */
  get supportsFix() {
    return false;
  }

  /** Always checks everything — see the header. */
  get wholeProgram() {
    return true;
  }

  get tier() {
    return TIER.LOCAL;
  }

  /**
   * Whole-program type checking on a real codebase is seconds to minutes, not
   * milliseconds. That is too slow for every commit and fine once per push — the
   * same call `contract` makes, and the reason `stage` is an axis of its own rather
   * than a property of `tier`.
   */
  get stage() {
    return STAGE.PUSH;
  }

  get sourceExtensions() {
    return ['.ts', '.tsx', '.mts', '.cts'];
  }

  configFiles() {
    return TSCONFIG_FILES;
  }

  /** Prefer the app's own TypeScript, then the repo root's, then PATH. */
  get binary() {
    return this.resolveBinary([
      path.join(this.appRoot, 'node_modules', '.bin', 'tsc'),
      path.join(this.projectRoot, 'node_modules', '.bin', 'tsc'),
      'tsc',
    ]);
  }

  /**
   * Bind ONLY where there is a tsconfig to check against.
   *
   * Deliberately stricter than the base implementation, which would also bind on a
   * loose `.ts` file anywhere in the tree. Without a tsconfig there is no program to
   * check — `tsc --noEmit` would either pick up a parent project by accident or fail
   * with TS18003 — and a JS repo with one stray `.d.ts` should hear nothing at all.
   * A missing tsconfig is `no-code` (silent), never a skip (loud).
   */
  detect(dir) {
    if (!dir || !fs.existsSync(dir)) return false;
    return Boolean(this.resolveConfigPath(dir));
  }

  /**
   * Whole-program, so `targets` is ignored — see the header. Run in the directory
   * that owns the tsconfig, so reported paths are relative to the project and stay
   * stable no matter which unit invoked us.
   */
  // eslint-disable-next-line no-unused-vars
  buildCommand(targets, opts = {}) {
    const config = this.resolveConfigPath(opts.cwd || this.appRoot);
    const cwd = config ? path.dirname(config) : opts.cwd || this.appRoot;
    return {
      cmd: this.binary,
      // --pretty false: no ANSI, no box drawing, one diagnostic per line.
      args: ['--noEmit', '--pretty', 'false'],
      cwd,
    };
  }

  parse(stdout, stderr) {
    // tsc writes diagnostics to stdout; keep stderr so a crash is not read as clean.
    const text = `${stdout || ''}\n${stderr || ''}`;
    const violations = [];
    let current = null;

    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (!line.trim()) continue;

      const match = DIAGNOSTIC.exec(line);
      if (match) {
        const [, file, lineNo, col, severity, code, message] = match;
        const relFile = this._relativize(file);
        current = createViolation({
          file: relFile,
          line: Number(lineNo),
          col: Number(col),
          ruleId: code,
          severity: severity === 'warning' ? SEVERITY.WARNING : SEVERITY.ERROR,
          message,
          source: 'tsc',
          fingerprintKey: typecheckKey(relFile, code, message),
        });
        violations.push(current);
        continue;
      }

      const global = GLOBAL_DIAGNOSTIC.exec(line);
      if (global) {
        const [, severity, code, message] = global;
        // No file to attach it to; anchor it to the config that governs the program.
        const anchor = TSCONFIG_FILES[0];
        current = createViolation({
          file: anchor,
          ruleId: code,
          severity: severity === 'warning' ? SEVERITY.WARNING : SEVERITY.ERROR,
          message,
          source: 'tsc',
          fingerprintKey: typecheckKey(anchor, code, message),
        });
        violations.push(current);
        continue;
      }

      // An indented continuation line carries the actual explanation ("Types of
      // property 'x' are incompatible"). Fold it into the message it belongs to
      // rather than dropping it — without it the headline is often unactionable.
      if (current && /^\s+\S/.test(line)) {
        current.message = `${current.message} ${line.trim()}`;
        current.fingerprintKey = typecheckKey(
          current.file,
          current.ruleId,
          current.message
        );
      }
    }

    return violations;
  }
}

module.exports = TscAdapter;
