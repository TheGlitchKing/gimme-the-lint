'use strict';

const fs = require('fs-extra');
const path = require('path');
const projectModel = require('./project-model');
const configManager = require('./config-manager');

// Ships gimme-the-lint's best-practice ("recommended" tier) linter configs
// into a project. Every write is CREATE-IF-ABSENT — a user's existing linter
// config is never overwritten (pass { force: true } to replace).
//
// For eslint / golangci-lint / clippy / tflint the config file is not the
// linter's detection key, so install genuinely seeds a config. For biome and
// ruff the config file IS the detection key (biome.json / pyproject.toml), so
// a discovered app already has one — the template then only applies on adoption
// or under --force.

// linter id -> { template filename, destination filename in the app dir }
const LINTER_CONFIGS = {
  eslint: { template: 'eslint.config.template.js', dest: 'eslint.config.js' },
  biome: { template: 'biome.template.json', dest: 'biome.json' },
  ruff: { template: 'pyproject.template.toml', dest: 'pyproject.toml' },
  'golangci-lint': { template: '.golangci.template.yml', dest: '.golangci.yml' },
  tflint: { template: '.tflint.template.hcl', dest: '.tflint.hcl' },
  clippy: { template: 'clippy.template.toml', dest: 'clippy.toml' },
  'ansible-lint': { template: '.ansible-lint.template.yml', dest: '.ansible-lint' },
};

/** Copy one template into an app dir, create-if-absent. */
async function writeConfig(appRoot, linterId, options = {}) {
  const spec = LINTER_CONFIGS[linterId];
  if (!spec) return { linter: linterId, status: 'skipped', reason: 'no template' };

  const dest = path.join(appRoot, spec.dest);
  const result = { linter: linterId, file: spec.dest };

  if ((await fs.pathExists(dest)) && !options.force) {
    result.status = 'exists';
    return result;
  }
  try {
    const subs =
      linterId === 'eslint' ? { REACT_VERSION: options.reactVersion || '18.3' } : {};
    await configManager.copyTemplate(spec.template, dest, subs);
    result.status = 'created';
  } catch (e) {
    result.status = 'error';
    result.reason = e.message;
  }
  return result;
}

/** ESLint apps also get a Prettier config (create-if-absent). */
async function writePrettier(appRoot, options = {}) {
  const dest = path.join(appRoot, '.prettierrc.json');
  const result = { linter: 'prettier', file: '.prettierrc.json' };
  if ((await fs.pathExists(dest)) && !options.force) {
    result.status = 'exists';
    return result;
  }
  try {
    await configManager.copyTemplate('.prettierrc.template.json', dest);
    result.status = 'created';
  } catch (e) {
    result.status = 'error';
    result.reason = e.message;
  }
  return result;
}

/**
 * Clippy lint levels can only be declared in Cargo.toml's [lints.clippy]
 * table (clippy.toml tunes thresholds only). Append the table — but only if
 * Cargo.toml has no [lints] / [workspace.lints] table already.
 */
async function writeClippyLints(appRoot) {
  const cargoPath = path.join(appRoot, 'Cargo.toml');
  const result = { linter: 'clippy', file: 'Cargo.toml [lints.clippy]' };

  if (!(await fs.pathExists(cargoPath))) {
    return { ...result, status: 'skipped', reason: 'no Cargo.toml' };
  }
  const content = await fs.readFile(cargoPath, 'utf8');
  if (/^\s*\[(workspace\.)?lints/m.test(content)) {
    return { ...result, status: 'exists' };
  }
  try {
    const snippet = await fs.readFile(
      path.join(configManager.TEMPLATES_DIR, 'clippy-cargo-lints.template.toml'),
      'utf8'
    );
    const sep = content.endsWith('\n') ? '\n' : '\n\n';
    await fs.writeFile(cargoPath, content + sep + snippet, 'utf8');
    return { ...result, status: 'appended' };
  } catch (e) {
    return { ...result, status: 'error', reason: e.message };
  }
}

/**
 * Discover every app and seed its linters' best-practice configs.
 * @returns {Promise<{app, linter, file, status, reason?}[]>}
 */
async function writeLinterConfigs(projectRoot, options = {}) {
  const root = projectRoot || process.cwd();
  const apps = projectModel.discoverApps(root);
  const written = [];

  for (const app of apps) {
    const appRoot = path.resolve(root, app.appPath);
    for (const linterId of app.linters) {
      written.push({ app: app.appPath, ...(await writeConfig(appRoot, linterId, options)) });

      if (linterId === 'eslint') {
        written.push({ app: app.appPath, ...(await writePrettier(appRoot, options)) });
      }
      if (linterId === 'clippy') {
        written.push({ app: app.appPath, ...(await writeClippyLints(appRoot)) });
      }
    }
  }
  return written;
}

module.exports = {
  LINTER_CONFIGS,
  writeConfig,
  writePrettier,
  writeClippyLints,
  writeLinterConfigs,
};
