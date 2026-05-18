'use strict';

const fs = require('fs');
const path = require('path');
const { LinterAdapter } = require('./adapter');
const { createViolation, SEVERITY } = require('../violation');

// tflint adapter. tflint is the de-facto Terraform/OpenTofu linter; it emits a
// machine-readable report under `--format json`. Terraform has no manifest
// file — a directory of *.tf (or *.tofu) IS the module — so detection is
// extension-based. tflint is module-scoped: it lints the .tf files of one
// directory, so the adapter resolves and runs inside that directory.
//
// tflint's bundled `terraform` ruleset is a universal, provider-independent
// baseline — it lints ANY Terraform repo (hyperscaler, on-prem, SaaS, network
// appliances, local/null/random) with zero config. Provider-specific rulesets
// (aws/google/azurerm/…) are opt-in and owned entirely by the target repo's
// own .tflint.hcl. This adapter never names a provider: it always runs core
// tflint and, when a .tflint.hcl is present, parses it GENERICALLY to drive
// `--init`, availability checks and ruleset-version tracking.

const TFLINT_CONFIG_FILES = ['.tflint.hcl'];

/** Map a tflint severity string onto a NormalizedViolation severity. */
function mapSeverity(severity) {
  switch (String(severity).toLowerCase()) {
    case 'error':
      return SEVERITY.ERROR;
    case 'notice':
    case 'info':
      return SEVERITY.INFO;
    case 'warning':
    default:
      return SEVERITY.WARNING;
  }
}

class TflintAdapter extends LinterAdapter {
  get id() {
    return 'tflint';
  }

  get languages() {
    return ['terraform'];
  }

  get supportsFix() {
    return true;
  }

  // A .tflint.hcl is a hint, not the discovery signal — *.tf source is (see
  // sourceExtensions / project-model.js). `.terraform.lock.hcl` is NOT listed:
  // it is a provider-lock file written by `terraform init`, frequently absent,
  // and no signal that tflint applies.
  get manifestFiles() {
    return ['.tflint.hcl'];
  }

  get sourceExtensions() {
    return ['.tf', '.tofu'];
  }

  configFiles() {
    return TFLINT_CONFIG_FILES;
  }

  // --- .tflint.hcl introspection (generic — no provider is special-cased) ---

  /** True when an effective .tflint.hcl exists (the unit dir or up to root). */
  _hasConfig(dir) {
    return this.resolveConfigPath(dir) !== null;
  }

  /**
   * Enumerate every `plugin "<name>"` block in the EFFECTIVE .tflint.hcl —
   * the one resolveConfigPath() resolves, which may live up at the repo root,
   * not in the unit dir.
   */
  _declaredPlugins(dir) {
    const configPath = this.resolveConfigPath(dir);
    if (!configPath) return [];
    let hcl;
    try {
      hcl = fs.readFileSync(configPath, 'utf8');
    } catch {
      return [];
    }
    const names = [];
    const re = /plugin\s+"([^"]+)"/g;
    let m;
    while ((m = re.exec(hcl)) !== null) names.push(m[1]);
    return names;
  }

  /** Cached `tflint --version` output (memoized after any --init has run). */
  _versionOutput() {
    if (this._versionOut == null) {
      const result = this._probe();
      this._versionOut = `${result.stdout || ''}\n${result.stderr || ''}`;
      this._versionProbeFailed = Boolean(result.error) || result.status !== 0;
    }
    return this._versionOut;
  }

  // --- init: fetch ruleset plugins a .tflint.hcl declares -------------------

  /**
   * When the unit carries a .tflint.hcl, tflint requires `tflint --init` to
   * fetch the declared ruleset plugins before linting — otherwise it exits
   * non-zero with a plugin error. Run it once per directory (cached by the
   * base adapter). A repo with no .tflint.hcl gets core linting, no init.
   */
  initCommand(cwd) {
    const configPath = this.resolveConfigPath(cwd);
    if (!configPath) return null;
    // Pass the resolved config explicitly so `--init` reads the right
    // .tflint.hcl for its plugin declarations — even when it lives up at the
    // repo root rather than in the unit dir.
    return { cmd: this.binary, args: ['--init', `--config=${configPath}`] };
  }

  // --- availability: agree with what lint() will actually see --------------

  /**
   * available() must agree with lint(). The binary must run AND every ruleset
   * plugin the unit's .tflint.hcl declares must resolve. Plugins are fetched
   * by `tflint --init`, so run it (idempotent, cached) before checking, then
   * confirm each declared plugin appears in `tflint --version` output. The
   * bundled `terraform` ruleset ships in the binary and always resolves.
   */
  available() {
    const probe = this._probe();
    if (probe.error || probe.status !== 0) return false;

    const declared = this._declaredPlugins(this.appRoot).filter(
      (name) => name !== 'terraform'
    );
    if (declared.length === 0) return true;

    this._ensureInitialized(this.appRoot);
    const installed = this.rulesetVersions();
    return declared.every((name) => name in installed);
  }

  // --- version reporting ----------------------------------------------------

  /** The tflint binary version, parsed deliberately from the version line. */
  version() {
    const match = this._versionOutput().match(/TFLint version (\d+\.\d+\.\d+)/i);
    return match ? match[1] : 'unknown';
  }

  /**
   * Installed ruleset-plugin versions, as a generic { name: version } map —
   * one entry per `+ ruleset.<name> (<version>...)` line of `tflint --version`.
   * No ruleset name is special-cased, so this tracks the bundled `terraform`
   * ruleset and any provider ruleset a repo opts into, current or future.
   * @returns {Object<string,string>}
   */
  rulesetVersions() {
    const versions = {};
    for (const line of this._versionOutput().split('\n')) {
      // "+ ruleset.terraform (0.7.0, bundled)"  /  "+ ruleset.aws (0.30.0)"
      const m = line.match(/^\s*\+\s*ruleset\.(\S+)\s*\(\s*([0-9][^,)\s]*)/);
      if (m) versions[m[1]] = m[2];
    }
    return versions;
  }

  buildCommand(targets, opts = {}) {
    const args = ['--format=json'];
    if (opts.fix && this.supportsFix) args.push('--fix');

    // tflint lints whichever directory it runs in. Resolve a run directory
    // from the target — a directory target directly, or the parent directory
    // of a file target (changed-files mode) — and lint there with no path
    // arguments, which keeps the adapter compatible with tflint versions that
    // predate `--chdir`.
    let cwd = opts.cwd || this.projectRoot;
    const first = targets && targets.length ? targets[0] : null;
    if (first && first !== '.') {
      const abs = path.resolve(this.projectRoot, first);
      try {
        cwd = fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
      } catch {
        // Unresolvable target — fall back to the default cwd.
      }
    }

    // tflint runs IN the unit dir; pass the effective config — which may live
    // up at the repo root — as an absolute --config so the unit is linted with
    // the repo's preset / plugin declarations / rule overrides, not tflint
    // defaults. No config anywhere → plain tflint (zero-config core ruleset).
    const configPath = this.resolveConfigPath(cwd);
    if (configPath) args.push(`--config=${configPath}`);

    return { cmd: this.binary, args, cwd };
  }

  /**
   * @param {string} stdout
   * @param {string} stderr
   * @param {number|null} code  tflint's exit code.
   */
  parse(stdout, stderr, code) {
    const text = (stdout || '').trim();
    let report = null;
    if (text) {
      try {
        report = JSON.parse(text);
      } catch {
        report = null;
      }
    }

    // A non-zero exit with no parseable JSON is a hard failure — an
    // uninitialized ruleset plugin, a broken config, an unusable binary. It
    // must be LOUD: emit a synthetic high-severity violation carrying the
    // stderr text, never let a failed run be recorded as a clean baseline.
    if (!report) {
      if (code != null && code !== 0) {
        return [
          createViolation({
            file: '',
            ruleId: 'tflint-error',
            severity: SEVERITY.ERROR,
            message: `tflint exited ${code}: ${(stderr || '').trim() || 'no output'}`,
            source: 'tflint',
          }),
        ];
      }
      return [];
    }

    const violations = [];

    const issues = Array.isArray(report.issues) ? report.issues : [];
    for (const issue of issues) {
      const range = issue.range || {};
      const start = range.start || {};
      const end = range.end || {};
      const rule = issue.rule || {};
      violations.push(
        createViolation({
          file: this._relativize(range.filename || ''),
          line: start.line,
          col: start.column,
          endLine: end.line,
          endCol: end.column,
          ruleId: rule.name || 'tflint',
          severity: mapSeverity(rule.severity),
          message: issue.message,
          source: 'tflint',
        })
      );
    }

    // tflint reports configuration / HCL parse failures in a separate
    // `errors` array — treat each as a blocking error so broken Terraform
    // fails the check rather than slipping through as zero issues.
    const errors = Array.isArray(report.errors) ? report.errors : [];
    for (const err of errors) {
      const range = err.range || {};
      const start = range.start || {};
      violations.push(
        createViolation({
          file: this._relativize(range.filename || ''),
          line: start.line,
          col: start.column,
          ruleId: 'tflint-error',
          severity: SEVERITY.ERROR,
          message: err.message || err.summary || 'tflint error',
          source: 'tflint',
        })
      );
    }

    return violations;
  }
}

module.exports = TflintAdapter;
