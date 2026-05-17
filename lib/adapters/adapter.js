'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// LinterAdapter is the contract every linter plugs into. Concrete adapters
// (eslint, ruff, golangci-lint, clippy, ...) extend this and implement only
// buildCommand() + parse(); everything else — detection, availability probing,
// version probing, process execution — is shared here.
//
// Two detection predicates are kept deliberately separate:
//   detect(dir)   — is there CODE for this language here?
//   available()   — is the linter BINARY installed and runnable?
// That split is what makes the polyglot model idempotent: a missing language
// is a silent no-op, while a missing binary for present code is a loud skip.

// Directories never worth scanning for source files.
const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', '.next', '.nuxt', 'coverage',
  '__pycache__', '.venv', 'venv', 'env', 'target', 'vendor',
  '.gtl', '.lttf', '.lttf-ruff', '.git', '.planning',
]);

// How deep detect() will recurse looking for a source file.
const SCAN_DEPTH = 5;

class LinterAdapter {
  constructor({ projectRoot } = {}) {
    this.projectRoot = projectRoot || process.cwd();
  }

  // --- identity (override in subclasses) ---
  get id() {
    throw new Error('LinterAdapter subclass must define id');
  }
  get languages() {
    return [];
  }
  get supportsFix() {
    return false;
  }

  // --- detection inputs (override) ---
  /** Manifest filenames that prove this language lives in a directory. */
  get manifestFiles() {
    return [];
  }
  /** Source file extensions for this language. */
  get sourceExtensions() {
    return [];
  }
  /** The linter executable — a bare name (PATH lookup) or a resolved path. */
  get binary() {
    return this.id;
  }
  /** Config filenames whose hash defines config drift for this linter. */
  configFiles() {
    return [];
  }

  /** Return the first candidate path that exists, else the last candidate. */
  resolveBinary(candidates) {
    for (const candidate of candidates) {
      if (candidate.includes(path.sep) && fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return candidates[candidates.length - 1];
  }

  /** Is there code for this language at or under `dir`? */
  detect(dir) {
    if (!dir || !fs.existsSync(dir)) return false;
    for (const manifest of this.manifestFiles) {
      if (fs.existsSync(path.join(dir, manifest))) return true;
    }
    return this._scanForSource(dir, SCAN_DEPTH);
  }

  _scanForSource(dir, depth) {
    if (depth < 0) return false;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (DEFAULT_IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        if (this._scanForSource(path.join(dir, entry.name), depth - 1)) {
          return true;
        }
      } else if (entry.isFile()) {
        if (this.sourceExtensions.some((ext) => entry.name.endsWith(ext))) {
          return true;
        }
      }
    }
    return false;
  }

  /** Arguments that print the linter version (override if not `--version`). */
  versionArgs() {
    return ['--version'];
  }

  _probe() {
    return spawnSync(this.binary, this.versionArgs(), {
      cwd: this.projectRoot,
      encoding: 'utf8',
    });
  }

  /** Is the linter binary installed and runnable? */
  available() {
    const result = this._probe();
    return !result.error && result.status === 0;
  }

  /** Linter version string (e.g. "9.21.0"), or "unknown". */
  version() {
    const result = this._probe();
    if (result.error) return 'unknown';
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const match = output.match(/\d+\.\d+\.\d+/);
    return match ? match[0] : 'unknown';
  }

  // --- override: command construction ---
  /**
   * @param {string[]} targets Files or directories to lint.
   * @param {object} opts { fix, cwd }
   * @returns {{cmd: string, args: string[], cwd?: string, env?: object}}
   */
  // eslint-disable-next-line no-unused-vars
  buildCommand(targets, opts) {
    throw new Error(`${this.id}: buildCommand() not implemented`);
  }

  // --- override: output parsing ---
  /**
   * @param {string} stdout
   * @param {string} stderr
   * @param {number|null} code
   * @returns {object[]} NormalizedViolation[]
   */
  // eslint-disable-next-line no-unused-vars
  parse(stdout, stderr, code) {
    throw new Error(`${this.id}: parse() not implemented`);
  }

  /**
   * Run the linter against `targets` and return NormalizedViolation[].
   * Shared: builds the command, executes it, hands output to parse().
   */
  lint(targets, opts = {}) {
    const spec = this.buildCommand(targets, opts);
    const result = spawnSync(spec.cmd, spec.args, {
      cwd: spec.cwd || this.projectRoot,
      env: spec.env ? { ...process.env, ...spec.env } : process.env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) {
      const err = new Error(
        `${this.id}: execution failed — ${result.error.message}`
      );
      err.code = 'ADAPTER_EXEC_FAILED';
      throw err;
    }
    return this.parse(result.stdout || '', result.stderr || '', result.status);
  }
}

module.exports = { LinterAdapter, DEFAULT_IGNORE_DIRS };
