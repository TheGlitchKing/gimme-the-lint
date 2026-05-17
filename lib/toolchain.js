'use strict';

const adapters = require('./adapters');

// Toolchain inspection: which linter binaries are actually installed. This is
// the per-language generalization of v1's Python-only venv check — every
// adapter answers available()/version() the same way, so one helper covers
// JS, Python, Go, Rust and anything added later. Used by the `status` command
// and by the --offline install preflight.

/**
 * Report availability + version for every registered linter.
 * @returns {{linter, languages, available, version}[]}
 */
function checkToolchains(projectRoot) {
  const root = projectRoot || process.cwd();
  return adapters.listAdapters().map((id) => {
    const adapter = adapters.getAdapter(id, { projectRoot: root });
    const available = adapter.available();
    return {
      linter: id,
      languages: adapter.languages,
      available,
      version: available ? adapter.version() : null,
    };
  });
}

/**
 * Report toolchain status for only the linters a project actually uses.
 * @param {string} projectRoot
 * @param {string[]} linterIds  Linter ids in use (e.g. from resolveUnits()).
 */
function checkRequired(projectRoot, linterIds) {
  const wanted = new Set(linterIds || []);
  return checkToolchains(projectRoot).filter((t) => wanted.has(t.linter));
}

module.exports = {
  checkToolchains,
  checkRequired,
};
