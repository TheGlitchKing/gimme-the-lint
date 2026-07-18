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

// TIER — what an adapter NEEDS in order to run.
//   local     — files on disk (plus, at most, the app's own venv/node_modules).
//   reference — the above, plus git HISTORY (to diff against a base ref).
//   external  — the above, plus a network: a live database, a schema registry.
//
// The tier exists to protect two invariants the engine holds on purpose: `check`
// is a hermetic pre-commit hook, and `--offline` is a real air-gapped mode. An
// `external` adapter can therefore NEVER run inside `check` — not by convention,
// but structurally (see check.js). It is reachable only from the CI-facing
// `verify` command.
const TIER = Object.freeze({
  LOCAL: 'local',
  REFERENCE: 'reference',
  EXTERNAL: 'external',
});

// STAGE — WHEN an adapter fires. Orthogonal to tier: tier is about capability
// (what must exist), stage is about cost (what a developer will wait for).
//   commit — fast enough for a pre-commit hook. The default; every linter.
//   push   — too slow for every commit, but fine once per push. An adapter that
//            must import the whole app to say anything lives here.
//   ci     — never on a hook at all.
//
// A `local` adapter can still be too slow for a commit hook, which is why this
// is a separate axis rather than a property of the tier.
const STAGE = Object.freeze({
  COMMIT: 'commit',
  PUSH: 'push',
  CI: 'ci',
});

// Directories never worth scanning for source files.
const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', '.next', '.nuxt', 'coverage',
  '__pycache__', '.venv', 'venv', 'env', 'target', 'vendor',
  '.gtl', '.lttf', '.lttf-ruff', '.git', '.planning',
]);

// How deep detect() will recurse looking for a source file.
const SCAN_DEPTH = 5;

class LinterAdapter {
  constructor({ projectRoot, appRoot } = {}) {
    this.projectRoot = projectRoot || process.cwd();
    // appRoot is the directory of the specific app/unit being linted. In a
    // monorepo each app carries its own node_modules / .venv, so project-local
    // tool resolution and config discovery must start here — not at the repo
    // root, which often has neither. Defaults to projectRoot for single-package
    // projects and for callers that do not supply it.
    this.appRoot = appRoot || this.projectRoot;
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

  /**
   * A MECHANICAL remedy that is not `--fix`, or null when there is none.
   *
   * Two different things get collapsed by a bare `supportsFix: false`: a finding a
   * human must reason about (`contract/column-not-writable` — is this column meant
   * to be writable?), and a finding a command regenerates (`contract/codegen-stale`
   * — the types are behind the lockfile; run `materialize`). Telling a reader to
   * "fix it by hand" in the second case sends them to edit a GENERATED file, which
   * the next `materialize` overwrites.
   *
   * Expressed on the adapter rather than per-rule id so the reporter never has to
   * know a rule name — the next adapter with a mechanical remedy needs no change
   * to report.js.
   * @returns {string|null} the command to run
   */
  get remediation() {
    return null;
  }

  /** What this adapter needs to run. See TIER. Default: files on disk only. */
  get tier() {
    return TIER.LOCAL;
  }

  /** When this adapter fires. See STAGE. Default: fast enough for every commit. */
  get stage() {
    return STAGE.COMMIT;
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

  /**
   * Resolve the EFFECTIVE config file for the unit being linted: walk up from
   * `startDir` (default: appRoot) to projectRoot inclusive and return the
   * absolute path of the nearest file named by configFiles(), or null if none
   * exists anywhere on that path.
   *
   * Root-aware — this is what lets a single repo-root config (the standard
   * monorepo layout: one config, many nested units) govern every unit. It is
   * the SINGLE source of truth shared by the config-hash (baseline.js) and the
   * linter invocation, so the hashed config and the linted config can never
   * disagree.
   * @param {string} [startDir]
   * @returns {string|null}
   */
  resolveConfigPath(startDir) {
    const names = this.configFiles();
    if (!names || names.length === 0) return null;
    const root = path.resolve(this.projectRoot);
    let dir = path.resolve(startDir || this.appRoot);
    while (true) {
      for (const name of names) {
        const candidate = path.join(dir, name);
        if (fs.existsSync(candidate)) return candidate;
      }
      if (dir === root) break; // checked projectRoot — stop
      const parent = path.dirname(dir);
      if (parent === dir) break; // filesystem root reached
      dir = parent;
    }
    return null;
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

  /**
   * Optional one-time setup command run in a directory BEFORE linting it —
   * e.g. `tflint --init` to fetch the ruleset plugins a .tflint.hcl declares.
   * Without it tflint exits non-zero on an uninitialized plugin. Return null
   * when no setup is needed (the default for every other adapter).
   * @param {string} cwd  The directory linting will run in.
   * @returns {{cmd: string, args: string[], env?: object}|null}
   */
  // eslint-disable-next-line no-unused-vars
  initCommand(cwd) {
    return null;
  }

  /**
   * Optional: DERIVE a schema artifact from the application, for frameworks where
   * the contract exists only at runtime.
   *
   * A schema-first project has an IDL on disk — a .proto, a .graphql, an
   * openapi.yaml — and the code is generated from it. There is a file to lint and a
   * file to diff, and this hook does nothing.
   *
   * A CODE-FIRST project (FastAPI, Django REST, Prisma, tRPC) has no such file. The
   * contract is computed from the code at import time and served over HTTP. It is
   * real, complete, and invisible to every tool that reads files — so nothing stops
   * a field rename from silently breaking every client. There is no artifact to
   * diff, so there is no diff, so there is no warning.
   *
   * materialize() writes it down, turning the second case into the first.
   *
   * Returns { path, content } — the file the engine should write, or null when the
   * adapter has nothing to derive (the default, and true of every linter).
   *
   * @param {object} opts
   * @returns {{path: string, content: string}|null}
   */
  // eslint-disable-next-line no-unused-vars
  materialize(opts = {}) {
    return null;
  }

  /** Run initCommand() once per directory, before the first lint there. */
  _ensureInitialized(cwd) {
    const spec = this.initCommand(cwd);
    if (!spec) return;
    if (!this._initialized) this._initialized = new Set();
    if (this._initialized.has(cwd)) return;
    this._initialized.add(cwd);
    spawnSync(spec.cmd, spec.args, {
      cwd,
      env: spec.env ? { ...process.env, ...spec.env } : process.env,
      encoding: 'utf8',
    });
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
   * Relativize a linter-reported path against the directory the linter ran
   * in. Go/Rust adapters run inside the package directory (module/crate
   * awareness), so reported paths must be relativized against that, not the
   * repo root. Baselines are per-app, so per-app-relative paths stay unique.
   */
  _relativize(file) {
    if (!file) return '';
    const base = this._runCwd || this.projectRoot;
    return path.relative(base, path.resolve(base, file)).split(path.sep).join('/');
  }

  /**
   * Run the linter against `targets` and return NormalizedViolation[].
   * Shared: builds the command, executes it, hands output to parse().
   */
  lint(targets, opts = {}) {
    const spec = this.buildCommand(targets, opts);
    this._runCwd = spec.cwd || this.projectRoot;
    this._ensureInitialized(this._runCwd);
    const result = spawnSync(spec.cmd, spec.args, {
      cwd: this._runCwd,
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

module.exports = { LinterAdapter, DEFAULT_IGNORE_DIRS, TIER, STAGE };
