'use strict';

const adapters = require('./adapters');
const { resolveUnits } = require('./units');

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

/**
 * Find "gaps": apps that contain code for a language whose linter binary is
 * not installed. This is exactly the warn+skip condition — under --offline it
 * is escalated to a hard install failure, since provisioning is supposed to
 * guarantee the binary.
 * @returns {{app, linter, languages}[]}
 */
function findGaps(projectRoot) {
  const root = projectRoot || process.cwd();
  const gaps = [];
  for (const unit of resolveUnits(root)) {
    for (const linterId of unit.linters) {
      let adapter;
      try {
        adapter = adapters.getAdapter(linterId, { projectRoot: root });
      } catch {
        continue;
      }
      if (adapter.detect(unit.root) && !adapter.available()) {
        gaps.push({ app: unit.id, linter: linterId, languages: adapter.languages });
      }
    }
  }
  return gaps;
}

module.exports = {
  checkToolchains,
  checkRequired,
  findGaps,
};

