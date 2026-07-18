'use strict';

const fs = require('fs');
const path = require('path');
const { LinterAdapter, TIER, STAGE } = require('./adapter');
const { createViolation, SEVERITY } = require('../violation');
const { typecheckKey } = require('./typecheck-identity');

// mypy adapter. Parses `mypy --no-error-summary --show-error-codes --show-column-numbers`.
//
// Whole-program, for the same reason as tsc: change a function's return annotation
// and the errors appear in its CALLERS, which the commit never touched. See the
// header of tsc.js for the full argument — it applies here unchanged, and so does
// the conclusion: ignore `targets`, always check the whole package, and let the
// engine's set-vs-set diff decide what is new.

const MYPY_CONFIG_FILES = ['mypy.ini', '.mypy.ini', 'setup.cfg', 'pyproject.toml'];

// `path/to/file.py:12:5: error: message  [error-code]`
// The column is only present with --show-column-numbers, so it is optional here:
// a user's own mypy.ini can turn the flag back off.
const DIAGNOSTIC =
  /^(.+?):(\d+)(?::(\d+))?:\s+(error|warning|note):\s+(.*?)(?:\s+\[([a-z0-9-]+)\])?$/;

class MypyAdapter extends LinterAdapter {
  get id() {
    return 'mypy';
  }

  get languages() {
    return ['python'];
  }

  get supportsFix() {
    return false;
  }

  get tier() {
    return TIER.LOCAL;
  }

  /** Slow enough to matter on a real codebase. Same call as tsc — see tsc.js. */
  get stage() {
    return STAGE.PUSH;
  }

  get sourceExtensions() {
    return ['.py', '.pyi'];
  }

  configFiles() {
    return MYPY_CONFIG_FILES;
  }

  /** Prefer the app venv's mypy, then the repo-root venv, then PATH. */
  get binary() {
    return this.resolveBinary([
      path.join(this.appRoot, '.venv', 'bin', 'mypy'),
      path.join(this.projectRoot, '.venv', 'bin', 'mypy'),
      'mypy',
    ]);
  }

  /**
   * Python code present is enough — unlike tsc, mypy runs perfectly well with no
   * config file at all (its defaults are permissive but real). Requiring a config
   * would silently exclude every repo that has not adopted one yet, which is most
   * of them, and a check that binds to nothing is a check nobody notices is missing.
   */
  detect(dir) {
    if (!dir || !fs.existsSync(dir)) return false;
    return super.detect(dir);
  }

  /** Whole-program: `targets` is ignored on purpose. See tsc.js. */
  // eslint-disable-next-line no-unused-vars
  buildCommand(targets, opts = {}) {
    return {
      cmd: this.binary,
      args: [
        '--no-error-summary',
        '--show-error-codes',
        '--show-column-numbers',
        '--no-color-output',
        '.',
      ],
      cwd: opts.cwd || this.appRoot,
    };
  }

  parse(stdout, stderr) {
    const text = `${stdout || ''}\n${stderr || ''}`;
    const violations = [];
    let current = null;

    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (!line.trim()) continue;

      const match = DIAGNOSTIC.exec(line);
      if (!match) continue;

      const [, file, lineNo, col, severity, message, code] = match;

      // A `note:` is not a finding — it is the previous error's explanation, and
      // mypy emits several per error. Reported on its own it would trigger a block
      // for something that is not a problem; dropped entirely it takes the actual
      // reason with it. So it is folded into the error it follows.
      if (severity === 'note') {
        if (current) {
          current.message = `${current.message} ${message.trim()}`;
          current.fingerprintKey = typecheckKey(
            current.file,
            current.ruleId,
            current.message
          );
        }
        continue;
      }

      const relFile = this._relativize(file);
      // mypy omits the code for a few diagnostics; without one there is nothing
      // stable to key on but the rule name itself.
      const ruleId = code || 'mypy-error';
      current = createViolation({
        file: relFile,
        line: Number(lineNo),
        col: col ? Number(col) : undefined,
        ruleId,
        severity: severity === 'warning' ? SEVERITY.WARNING : SEVERITY.ERROR,
        message,
        source: 'mypy',
        fingerprintKey: typecheckKey(relFile, ruleId, message),
      });
      violations.push(current);
    }

    return violations;
  }
}

module.exports = MypyAdapter;
