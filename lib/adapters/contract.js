'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { LinterAdapter, TIER, STAGE } = require('./adapter');
const { createViolation, SEVERITY } = require('../violation');
const configManager = require('../config-manager');

// The entity-contract adapter.
//
// Every other adapter in this directory wraps somebody else's linter. This one
// wraps OURS — `gtl-contract`, the Python introspector in python/ — because no
// third-party tool checks whether a persistence model agrees with the schemas that
// expose it. That is the only thing unusual about it. Structurally it is `ruff.js`:
// resolve a binary out of the venv, run it, parse JSON, hand back violations.
//
// stage: 'push', not 'commit'
// ---------------------------
// The checker IMPORTS the application to read its ORM registry and route table
// (see python/README.md for why parsing cannot work). That costs seconds. Seconds
// are fine once per push; they are not fine on every commit, and a slow commit hook
// is a hook people turn off — a disabled hook guards nothing at all.
//
// This is a better fit, not a compromise: the check was never file-scoped. It
// inspects the whole model layer at once, so "lint only the staged files" was never
// a meaningful operation for it.

class ContractAdapter extends LinterAdapter {
  get id() {
    return 'contract';
  }

  get languages() {
    return ['python'];
  }

  /** There is no autofix. See the report guidance in lib/report.js. */
  get supportsFix() {
    return false;
  }

  get tier() {
    return TIER.LOCAL; // imports the app, but touches no network
  }

  get stage() {
    return STAGE.PUSH;
  }

  get manifestFiles() {
    return ['pyproject.toml', 'setup.py', 'requirements.txt'];
  }

  get sourceExtensions() {
    return ['.py'];
  }

  /** Prefer the app venv, then the repo-root venv, then PATH — as ruff does. */
  get binary() {
    return this.resolveBinary([
      path.join(this.appRoot, '.venv', 'bin', 'gtl-contract'),
      path.join(this.projectRoot, '.venv', 'bin', 'gtl-contract'),
      'gtl-contract',
    ]);
  }

  /**
   * gtl-contract's own config lives inside .gtl/config.js under `contract`, so
   * drift in it is drift in this linter's config — exactly like eslint.config.js
   * is for ESLint.
   */
  configFiles() {
    return ['.gtl/config.js', '.gtl/config.cjs', 'gimme-the-lint.config.js'];
  }

  versionArgs() {
    return ['--help']; // argparse exits 0; there is no --version subcommand
  }

  /**
   * The `contract` block of the user's gimme-the-lint config, or {}.
   *
   * The user authors ONE config file (.gtl/config.js). Python never parses
   * JavaScript: we read it here, in Node, and hand the checker plain JSON.
   */
  _contractConfig() {
    const cfg = configManager.getConfig(this.projectRoot) || {};
    return cfg.contract || {};
  }

  /**
   * Is there a Python app here worth checking?
   *
   * Deliberately cheap and deliberately WRONG-SIDED: this must not import
   * anything. detect() runs for every unit, and importing an application to
   * discover that it is not a Python app would be absurd. The real determination
   * ("is there a model layer?") is the checker's, and it answers with a skip.
   */
  detect(dir) {
    if (!dir || !fs.existsSync(dir)) return false;
    for (const manifest of this.manifestFiles) {
      if (fs.existsSync(path.join(dir, manifest))) return true;
    }
    return this._scanForSource(dir, 3);
  }

  buildCommand(targets, opts = {}) {
    // Whole-app introspection: `targets` is meaningless here, and accepting it
    // would imply a per-file granularity this check does not have.
    const cwd = opts.cwd || this.appRoot;
    const args = ['check', '--root', cwd];

    const contractConfig = this._contractConfig();
    if (Object.keys(contractConfig).length) {
      // A temp file, not argv: a config with fifty pinned request bodies would
      // blow the command-line length limit on some platforms, and would do it
      // only for the largest projects — the ones most likely to need it.
      const file = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-contract-')),
        'config.json'
      );
      fs.writeFileSync(file, JSON.stringify(contractConfig));
      this._configFile = file;
      args.push('--config', file);
    }

    return { cmd: this.binary, args, cwd };
  }

  /**
   * gtl-contract prints ONE JSON object on stdout and nothing else.
   *
   * The important case is not the violations — it is `checked: false`. That means
   * the checker could not see the application (no venv, an unimportable module, an
   * empty ORM registry). Zero violations because we looked and found none, and zero
   * violations because we could not look, are the same number and opposite facts.
   * Collapsing them would let a broken import masquerade as a clean bill of health,
   * so a skip is raised as an error the engine reports as SKIPPED — never as a pass.
   */
  parse(stdout, stderr, code) {
    const text = (stdout || '').trim();

    if (!text) {
      const err = new Error(
        `contract: the checker produced no output${stderr ? ` — ${stderr.trim()}` : ''}`
      );
      err.code = 'CONTRACT_NO_OUTPUT';
      throw err;
    }

    let report;
    try {
      report = JSON.parse(text);
    } catch {
      const err = new Error(
        'contract: could not parse the checker output as JSON. An unparseable ' +
          'linter is a silently absent one, so this is an error rather than an ' +
          'empty result.'
      );
      err.code = 'CONTRACT_BAD_OUTPUT';
      throw err;
    }

    if (report.checked === false) {
      const err = new Error(
        report.detail
          ? `${report.skip}\n${indent(report.detail)}`
          : report.skip || 'the contract could not be checked'
      );
      // Mapped onto the engine's idempotent-skip contract by checkUnit(): a loud
      // warning that never blocks. It means UNCHECKED, and it says so.
      err.code = 'ADAPTER_SKIPPED';
      throw err;
    }

    return (report.violations || []).map((v) =>
      createViolation({
        file: v.file,
        line: v.line,
        ruleId: v.ruleId,
        severity: v.severity === 'warning' ? SEVERITY.WARNING : SEVERITY.ERROR,
        message: v.message,
        source: 'contract',
        // Identity is the SUBJECT, not the file: a schema that moves keeps its
        // baseline. See lib/fingerprint.js.
        fingerprintKey: v.fingerprintKey,
        // Carried from the rule's own metadata. The engine never holds a hardcoded
        // list of un-baselineable rules — rules belong to the provider.
        neverBaseline: v.neverBaseline === true,
      })
    );
  }

  /** The rule catalogue, for `--explain` and the docs. */
  rules() {
    const result = spawnSync(this.binary, ['rules'], { encoding: 'utf8' });
    if (result.error || result.status !== 0) return [];
    try {
      return JSON.parse(result.stdout).rules || [];
    } catch {
      return [];
    }
  }
}

function indent(text) {
  return String(text)
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

module.exports = ContractAdapter;
