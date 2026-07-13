'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ContractAdapter = require('./contract');
const { createViolation, SEVERITY } = require('../violation');

// The API contract lockfile.
//
// A second registry entry over the same `gtl-contract` binary, deliberately separate
// from the `contract` adapter. They answer different questions and should baseline
// independently: you may well carry model/schema debt for a quarter while accepting
// ZERO drift between your API and its published contract. One baseline section each,
// which baseline.json has supported since v2.
//
// WHAT IT GUARDS
//
// FastAPI computes an OpenAPI document from your Pydantic schemas and serves it at
// /openapi.json. It is complete and correct — and invisible to every tool that reads
// files. So nothing stops a field rename from silently breaking every client of that
// endpoint: there is no artifact to diff, so there is no diff, so there is no warning.
//
// `gimme-the-lint materialize` writes it down. `check` then compares the live
// document against the committed one and reports when they part company.
//
// THE FILE-CLASS RULE
//
// A config is YOURS: seeded once, never clobbered (linter-configs.js).
// A baseline is GENERATED: written by `baseline`, never by `check`.
// A lockfile is COMPILED: always regenerated, because a stale one describes an API
// you no longer serve — and a guard that reports on an API you no longer serve is
// worse than no guard, because it is believed.
//
// But a HAND-AUTHORED openapi.yaml is none of those. It is a source of truth in a
// schema-first project, and overwriting it destroys human work. Both mistakes are
// reachable from the same wrong assumption in opposite directions, so the mode is
// never inferred: the emitted document carries `x-generated-by`, and a file WITHOUT
// that marker is authored and sacred. When an authored spec and the code disagree,
// that disagreement is itself the finding — and neither file is touched.

const DEFAULT_LOCKFILE = 'openapi.json';

class OpenApiAdapter extends ContractAdapter {
  get id() {
    return 'openapi';
  }

  get languages() {
    return ['python'];
  }

  get supportsFix() {
    // `materialize` regenerates the lockfile, but that is a deliberate, developer-run
    // command — never something a hook does behind your back. A pre-commit hook that
    // edits your working tree is a hostile pre-commit hook.
    return false;
  }

  /** The committed lockfile, relative to the app. */
  lockfilePath() {
    const configured = this._contractConfig().lockfile;
    return path.resolve(this.appRoot, configured || DEFAULT_LOCKFILE);
  }

  /**
   * Is this an app whose API contract we can derive at all? Requires a configured
   * ASGI app — guessing wrong here means importing something that is not an app.
   */
  detect(dir) {
    if (!dir || !fs.existsSync(dir)) return false;
    const cfg = this._contractConfig();
    if (cfg.app) return true;
    // No explicit app ref: only bind if the conventional entrypoint exists, so a
    // plain Python library never gets an OpenAPI check it has no use for.
    return (
      fs.existsSync(path.join(dir, 'app', 'main.py')) ||
      fs.existsSync(path.join(dir, 'main.py'))
    );
  }

  buildCommand(targets, opts = {}) {
    const cwd = opts.cwd || this.appRoot;
    const args = [
      'openapi',
      '--root',
      cwd,
      '--lockfile',
      this.lockfilePath(),
    ];
    const configFile = this._writeConfigFile();
    if (configFile) args.push('--config', configFile);
    return { cmd: this.binary, args, cwd };
  }

  /**
   * Derive the document and hand it back for writing. The ENGINE writes it — the
   * adapter never touches the filesystem — so there is exactly one code path that
   * can put bytes in a user's working tree, and it is reachable only from an
   * explicit `materialize` command.
   */
  materialize() {
    const lockfile = this.lockfilePath();

    // Provenance, checked BEFORE we generate anything. A file we did not write is a
    // hand-authored spec: it is the source of truth, not our output, and
    // regenerating over it would silently destroy somebody's work on a routine
    // command. No marker means authored, and authored is sacred.
    if (fs.existsSync(lockfile)) {
      let existing;
      try {
        existing = JSON.parse(fs.readFileSync(lockfile, 'utf8'));
      } catch {
        existing = null;
      }
      if (existing && existing['x-generated-by'] !== 'gimme-the-lint') {
        return {
          path: lockfile,
          skipped:
            `${path.relative(this.projectRoot, lockfile)} was hand-authored (no ` +
            'x-generated-by marker) — it is your source of truth, not our output, so ' +
            'it will not be overwritten. `check` will still report if the code stops ' +
            'matching it.',
        };
      }
    }

    const args = ['openapi', '--root', this.appRoot, '--emit'];
    const configFile = this._writeConfigFile();
    if (configFile) args.push('--config', configFile);

    const result = spawnSync(this.binary, args, {
      cwd: this.appRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    if (result.error || result.status !== 0) {
      const err = new Error(
        `openapi: could not derive the document — ${(result.stderr || '').trim() || (result.error && result.error.message)}`
      );
      err.code = 'MATERIALIZE_FAILED';
      throw err;
    }

    return { path: lockfile, content: result.stdout };
  }

  /** Write the contract config to a temp file; returns its path, or null. */
  _writeConfigFile() {
    const cfg = this._contractConfig();
    if (!Object.keys(cfg).length) return null;
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-openapi-'));
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify(cfg));
    return file;
  }

  parse(stdout, stderr, code) {
    const text = (stdout || '').trim();
    if (!text) {
      const err = new Error('openapi: the checker produced no output');
      err.code = 'CONTRACT_NO_OUTPUT';
      throw err;
    }

    let report;
    try {
      report = JSON.parse(text);
    } catch {
      const err = new Error('openapi: could not parse the checker output as JSON');
      err.code = 'CONTRACT_BAD_OUTPUT';
      throw err;
    }

    if (report.checked === false) {
      const err = new Error(
        report.detail ? `${report.skip}\n    ${report.detail}` : report.skip
      );
      err.code = 'ADAPTER_SKIPPED';
      throw err;
    }

    return (report.violations || []).map((v) =>
      createViolation({
        file: path.relative(this.projectRoot, v.file || ''),
        line: v.line,
        ruleId: v.ruleId,
        severity: SEVERITY.ERROR,
        message: v.message,
        source: 'openapi',
        fingerprintKey: v.fingerprintKey,
        // A stale lockfile is never baselineable: grandfathering it would switch the
        // guard off permanently while leaving it looking green — which is the exact
        // failure it exists to prevent.
        neverBaseline: v.ruleId !== 'contract/lockfile-missing',
      })
    );
  }
}

module.exports = OpenApiAdapter;
