'use strict';

const path = require('path');
const { LinterAdapter } = require('./adapter');
const { createViolation, SEVERITY } = require('../violation');

// Biome adapter. Biome is the single-binary ESLint+Prettier replacement; it
// emits a machine-readable report under `--reporter=json`. A project that
// carries a biome.json is treated as a Biome project — see project-model.js,
// which drops the default ESLint binding when Biome is configured.
//
// Biome's JSON locates diagnostics by byte span rather than line/column.
// That is fine here: fingerprints deliberately exclude position, so Biome
// violations baseline and diff correctly without line numbers.

const BIOME_CONFIG_FILES = ['biome.json', 'biome.jsonc'];

class BiomeAdapter extends LinterAdapter {
  get id() {
    return 'biome';
  }

  get languages() {
    return ['javascript', 'typescript'];
  }

  get supportsFix() {
    // Biome's fix flag changed across major versions (--apply vs --write);
    // keep fix off so the adapter never shells a flag the local Biome rejects.
    return false;
  }

  get manifestFiles() {
    return ['biome.json', 'biome.jsonc', 'package.json'];
  }

  get sourceExtensions() {
    return ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'];
  }

  /**
   * Prefer the app-local Biome, then the repo-root Biome, then PATH. Each JS
   * app in a monorepo has its own node_modules; resolving only at projectRoot
   * makes available() falsely return false for app-installed Biome.
   */
  get binary() {
    return this.resolveBinary([
      path.join(this.appRoot, 'node_modules', '.bin', 'biome'),
      path.join(this.projectRoot, 'node_modules', '.bin', 'biome'),
      'biome',
    ]);
  }

  configFiles() {
    return BIOME_CONFIG_FILES;
  }

  buildCommand(targets, opts = {}) {
    const args = ['lint', '--reporter=json'];
    // Run inside the app directory so Biome resolves the app's own biome.json.
    const cwd = opts.cwd || this.appRoot;
    const list = (targets && targets.length ? targets : ['.']).map((t) => {
      const rel = path.relative(cwd, path.resolve(this.projectRoot, t));
      return rel === '' ? '.' : rel;
    });
    args.push(...list);
    return { cmd: this.binary, args, cwd };
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
    const diagnostics =
      report && Array.isArray(report.diagnostics) ? report.diagnostics : [];

    return diagnostics.map((d) => {
      const loc = d.location || {};
      const file =
        loc.path && typeof loc.path === 'object'
          ? loc.path.file || ''
          : typeof loc.path === 'string'
            ? loc.path
            : '';
      // `description` is plain text; `message` is an array of text fragments.
      let message = d.description || '';
      if (!message && Array.isArray(d.message)) {
        message = d.message.map((m) => (m && m.content) || '').join('');
      }
      const severity =
        d.severity === 'error'
          ? SEVERITY.ERROR
          : d.severity === 'warning'
            ? SEVERITY.WARNING
            : SEVERITY.INFO;
      return createViolation({
        file: this._relativize(file),
        ruleId: d.category || 'biome',
        severity,
        message,
        source: 'biome',
      });
    });
  }
}

module.exports = BiomeAdapter;
