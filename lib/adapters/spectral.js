'use strict';

const fs = require('fs');
const path = require('path');
const { LinterAdapter, TIER, STAGE } = require('./adapter');
const { createViolation, SEVERITY } = require('../violation');

// OpenAPI / AsyncAPI / JSON Schema, via `spectral`.
//
// This is the SCHEMA-FIRST case, and the one place `openapi.js` deliberately does
// not go. If a repo carries a hand-authored openapi.yaml, that file is the source of
// truth: the server stubs and the client SDKs are generated FROM it. There is a real
// artifact on disk, so it can simply be linted — nothing needs materializing, and
// nothing may be overwritten.
//
// (A code-first FastAPI project has no such file. That case is `openapi.js`, which
// derives the document from the running app and writes it down as a lockfile. The two
// adapters look similar and solve opposite problems: one reads a spec somebody wrote,
// the other writes down a spec nobody did.)

const SPECTRAL_SEVERITY = {
  0: SEVERITY.ERROR,
  1: SEVERITY.WARNING,
  2: SEVERITY.INFO,
  3: SEVERITY.INFO,
};

const SPEC_FILES = [
  'openapi.yaml',
  'openapi.yml',
  'openapi.json',
  'asyncapi.yaml',
  'asyncapi.yml',
  'swagger.yaml',
  'swagger.json',
];

class SpectralAdapter extends LinterAdapter {
  get id() {
    return 'spectral';
  }

  get languages() {
    return ['openapi'];
  }

  get supportsFix() {
    return false;
  }

  get tier() {
    return TIER.LOCAL;
  }

  get stage() {
    return STAGE.COMMIT;
  }

  get sourceExtensions() {
    return ['.yaml', '.yml', '.json'];
  }

  get binary() {
    return this.resolveBinary([
      path.join(this.appRoot, 'node_modules', '.bin', 'spectral'),
      path.join(this.projectRoot, 'node_modules', '.bin', 'spectral'),
      'spectral',
    ]);
  }

  configFiles() {
    return ['.spectral.yaml', '.spectral.yml', '.spectral.json'];
  }

  /**
   * Only spec files, by name.
   *
   * A repo is full of .yaml and .json that are not API specs — CI workflows, package
   * manifests, fixtures, lockfiles. Handing spectral all of them produces a torrent of
   * findings about documents that were never meant to be OpenAPI, which is the fastest
   * possible way to teach somebody to uninstall a linter.
   */
  specFiles(dir) {
    const root = dir || this.appRoot;
    const found = [];
    for (const name of SPEC_FILES) {
      const p = path.join(root, name);
      if (fs.existsSync(p)) found.push(p);
    }
    // Also the conventional home for them.
    for (const sub of ['api', 'openapi', 'spec', 'specs']) {
      const subdir = path.join(root, sub);
      if (!fs.existsSync(subdir)) continue;
      let entries;
      try {
        entries = fs.readdirSync(subdir);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (SPEC_FILES.includes(name)) found.push(path.join(subdir, name));
      }
    }
    return found.sort();
  }

  detect(dir) {
    if (!dir || !fs.existsSync(dir)) return false;
    const specs = this.specFiles(dir);
    if (specs.length === 0) return false;

    // A file WE generated is a lockfile, and lockfiles are `openapi.js`'s business,
    // not spectral's. Linting our own output would report on a document the user never
    // wrote and cannot meaningfully edit — every finding would be unactionable.
    return specs.some((p) => !this._isGenerated(p));
  }

  _isGenerated(file) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      if (!raw.trimStart().startsWith('{')) return false; // YAML: never ours
      return JSON.parse(raw)['x-generated-by'] === 'gimme-the-lint';
    } catch {
      return false;
    }
  }

  buildCommand(targets, opts = {}) {
    const cwd = opts.cwd || this.appRoot;
    const files = this.specFiles(cwd).filter((p) => !this._isGenerated(p));
    return {
      cmd: this.binary,
      args: ['lint', '--format=json', '--quiet', ...files],
      cwd,
    };
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
        file: this._relativize(r.source || ''),
        line: r.range && r.range.start ? r.range.start.line + 1 : 0,
        col: r.range && r.range.start ? r.range.start.character + 1 : 0,
        ruleId: `spectral/${r.code}`,
        severity: SPECTRAL_SEVERITY[r.severity] || SEVERITY.WARNING,
        message: r.message || '',
        source: 'spectral',
        // The JSON Pointer — "#/paths/~1deals/post/responses" — names the thing that
        // is wrong, independently of where it sits in the file. A spec grows by
        // insertion, so line numbers move constantly and a path-and-line identity
        // would churn the baseline on every unrelated addition.
        fingerprintKey: r.path ? `${r.code}:${r.path.join('/')}` : undefined,
      })
    );
  }
}

module.exports = SpectralAdapter;
