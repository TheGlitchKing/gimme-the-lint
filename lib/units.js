'use strict';

const fs = require('fs');
const path = require('path');
const configManager = require('./config-manager');
const projectModel = require('./project-model');

// A "unit" is one app: a directory plus the linters bound to it. Units are the
// granularity at which gimme-the-lint baselines and checks. resolveUnits()
// produces them from gimme-the-lint.config.js, falling back to the legacy
// frontend/backend layout and then a single-package layout.
//
// Phase 3 replaces the internals of resolveUnits() with project-model.js
// (polyglot auto-discovery); the Unit shape it returns stays stable.

const GTL_DIR = '.gtl';

/** Absolute baseline.json path for an app, under .gtl/apps/<appPath>/. */
function baselinePathFor(projectRoot, appPath) {
  const sub = !appPath || appPath === '.' ? 'root' : appPath;
  return path.join(projectRoot, GTL_DIR, 'apps', sub, 'baseline.json');
}

/** Build a Unit record. */
function makeUnit(projectRoot, appPath, linters) {
  const normalized = !appPath || appPath === '.' ? '.' : appPath;
  return {
    id: normalized === '.' ? 'root' : normalized,
    appPath: normalized,
    root: path.resolve(projectRoot, normalized),
    linters: Array.isArray(linters) ? linters.slice() : [],
    baselinePath: baselinePathFor(projectRoot, normalized),
  };
}

/** Resolve all lint units for a project. */
function resolveUnits(projectRoot) {
  const root = projectRoot || process.cwd();
  const cfg = configManager.getConfig(root);

  // v2 config schema: explicit per-app linter binding takes precedence.
  if (cfg.apps && typeof cfg.apps === 'object' && Object.keys(cfg.apps).length) {
    return Object.entries(cfg.apps).map(([appPath, appCfg]) =>
      makeUnit(root, appPath, (appCfg && appCfg.linters) || [])
    );
  }

  // Auto-detect: walk the repo and bind each package to its linters.
  const discovered = projectModel.discoverApps(root, { config: cfg });
  if (discovered.length) {
    return discovered.map((app) => makeUnit(root, app.appPath, app.linters));
  }

  // Legacy frontend/backend layout (manifest-free src/ or app/ trees).
  const units = [];
  const frontendDir = cfg.frontendDir || 'frontend';
  const backendDir = cfg.backendDir || 'backend';
  const hasFrontend =
    fs.existsSync(path.join(root, frontendDir, cfg.srcDir || 'src')) ||
    fs.existsSync(path.join(root, frontendDir, 'package.json'));
  const hasBackend =
    fs.existsSync(path.join(root, backendDir, cfg.appDir || 'app')) ||
    fs.existsSync(path.join(root, backendDir, 'pyproject.toml'));
  if (hasFrontend) units.push(makeUnit(root, frontendDir, ['eslint']));
  if (hasBackend) units.push(makeUnit(root, backendDir, ['ruff']));
  if (units.length) return units;

  // Single-package layout: the project root is itself the app.
  const linters = [];
  if (fs.existsSync(path.join(root, 'package.json'))) linters.push('eslint');
  if (
    fs.existsSync(path.join(root, 'pyproject.toml')) ||
    fs.existsSync(path.join(root, 'requirements.txt'))
  ) {
    linters.push('ruff');
  }
  if (linters.length) return [makeUnit(root, '.', linters)];

  return [];
}

module.exports = {
  GTL_DIR,
  resolveUnits,
  makeUnit,
  baselinePathFor,
};
