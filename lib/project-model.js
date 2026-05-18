'use strict';

const fs = require('fs');
const path = require('path');
const configManager = require('./config-manager');

// The project model replaces v1's hardcoded frontend/ + backend/ assumption.
// It walks the repo, finds the manifest file in each package (package.json,
// pyproject.toml, go.mod, Cargo.toml, ...) and binds each package directory
// to the linters that manifest implies. This makes the polyglot Lambda-style
// monorepo — apps/orders-api (TS), apps/orders-worker (Py), apps/billing
// (Go), apps/audit (Rust) — discover cleanly with zero config.

// Manifest filename → linter id. These must be STRONG markers — a file whose
// presence reliably means "a real, separately-configured app lives here".
// `requirements.txt` is deliberately excluded: it is too weak (it shows up in
// load-test dirs, docs tooling, sub-utilities) and binding ruff to every dir
// that has one mis-binds nested noise and hides the real app.
const MANIFEST_LINTERS = {
  'package.json': 'eslint',
  'biome.json': 'biome',
  'biome.jsonc': 'biome',
  'pyproject.toml': 'ruff',
  'ruff.toml': 'ruff',
  '.ruff.toml': 'ruff',
  'setup.py': 'ruff',
  'go.mod': 'golangci-lint',
  'Cargo.toml': 'clippy',
  'ansible.cfg': 'ansible-lint',
  'galaxy.yml': 'ansible-lint',
};

// Terraform / OpenTofu have no manifest file — a directory of *.tf (or *.tofu)
// IS the module — so they are discovered by source extension rather than by a
// manifest filename, unlike every other supported language.
const TERRAFORM_EXTENSIONS = ['.tf', '.tofu'];

/** True if any directory entry is a Terraform/OpenTofu source file. */
function hasTerraformSource(entries) {
  return entries.some(
    (entry) =>
      entry.isFile() &&
      TERRAFORM_EXTENSIONS.some((ext) => entry.name.endsWith(ext))
  );
}

// Template/scaffold directories: linting them is pure noise. Skipped by
// convention; projects can add more via `skipPatterns` in the config.
const DEFAULT_SKIP_PATTERNS = ['_template-*', '__template__', '*.template.*'];

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage',
  'target', 'vendor', '.venv', 'venv', 'env', '__pycache__',
  '.gtl', '.lttf', '.lttf-ruff', '.planning',
]);

// How deep to walk looking for package manifests.
const MAX_DEPTH = 4;

/** Convert a simple glob (only `*` is special) to an anchored RegExp. */
function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesAny(name, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(name));
}

// package.json is a CONDITIONAL eslint marker — bound only when the directory
// looks like a real JS app, never on the filename alone. A devDependencies-
// only, "private": true, source-free package.json (one that merely pins a
// tooling dependency) must not be mistaken for a lintable JS application.
const JS_APP_PKG_FIELDS = ['dependencies', 'main', 'exports', 'bin', 'module', 'workspaces'];
const JS_SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'];
const ESLINT_BIOME_CONFIG_FILES = new Set([
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
  '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml',
  'biome.json', 'biome.jsonc',
]);

/** Recursively look for JS/TS source under a directory (bounded, skips noise). */
function hasJsSource(absDir, depth = 3) {
  if (depth < 0) return false;
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isFile() && JS_SOURCE_EXTENSIONS.some((ext) => e.name.endsWith(ext))) {
      return true;
    }
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    if (hasJsSource(path.join(absDir, e.name), depth - 1)) return true;
  }
  return false;
}

/** Does this directory look like a real, lintable JS app (not just tooling)? */
function looksLikeJsApp(absDir, entries) {
  // An ESLint / Biome config file is unambiguous.
  for (const e of entries) {
    if (e.isFile() && ESLINT_BIOME_CONFIG_FILES.has(e.name)) return true;
  }
  // A package.json with app-shaped fields — runtime dependencies, an entry
  // point, or a workspace declaration — is a real app. devDependencies alone
  // (a tooling-only manifest) is not.
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(absDir, 'package.json'), 'utf8')
    );
    if (JS_APP_PKG_FIELDS.some((field) => pkg[field] != null)) return true;
  } catch {
    // Unreadable / invalid package.json — fall through to the source scan.
  }
  // Otherwise bind eslint only if there is actual JS/TS source under the dir.
  return hasJsSource(absDir);
}

/** Every directory (relative to root) that holds at least one known manifest. */
function findManifestDirs(projectRoot) {
  const found = [];

  function walk(absDir, relDir, depth) {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    const linters = new Set();
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const linter = MANIFEST_LINTERS[entry.name];
      if (!linter) continue;
      if (entry.name === 'package.json') {
        // Conditional: only a real JS app, never a tooling-only manifest.
        if (looksLikeJsApp(absDir, entries)) linters.add('eslint');
      } else {
        linters.add(linter);
      }
    }
    if (hasTerraformSource(entries)) linters.add('tflint');
    if (linters.size > 0) {
      found.push({ dir: relDir || '.', linters });
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(
        path.join(absDir, entry.name),
        relDir ? `${relDir}/${entry.name}` : entry.name,
        depth + 1
      );
    }
  }

  walk(projectRoot, '', 0);
  return found;
}

/**
 * Discover the apps in a project, binding each to its linters.
 *
 * Workspace-root detection is PER LINTER: a manifest directory is an app for
 * linter L unless another manifest directory NESTED below it also carries L
 * (then the outer dir is a workspace root for L, and the nested dirs are the
 * apps). This is what lets a repo-root `pyproject.toml` (ruff) be a real
 * Python app even when nested `package.json` dirs (eslint) sit below it — the
 * old "any nested manifest ⇒ skip the whole dir" rule discarded the root
 * config and bound nothing for Python.
 * @returns {{appPath: string, linters: string[]}[]}
 */
function discoverApps(projectRoot, opts = {}) {
  const root = projectRoot || process.cwd();
  const cfg = opts.config || configManager.getConfig(root);
  const skipPatterns = [
    ...DEFAULT_SKIP_PATTERNS,
    ...(Array.isArray(cfg.skipPatterns) ? cfg.skipPatterns : []),
  ];

  const manifestDirs = findManifestDirs(root);

  // dir → Set<linter>, accumulated via the per-linter workspace-root rule.
  const appLinters = new Map();
  for (const entry of manifestDirs) {
    // Skip template/scaffold directories (match any path segment).
    const segments = entry.dir === '.' ? [] : entry.dir.split('/');
    if (segments.some((segment) => matchesAny(segment, skipPatterns))) continue;

    const childPrefix = entry.dir === '.' ? '' : `${entry.dir}/`;
    for (const linter of entry.linters) {
      const isWorkspaceRootForLinter = manifestDirs.some(
        (other) =>
          other.dir !== entry.dir &&
          other.dir.startsWith(childPrefix) &&
          other.linters.has(linter)
      );
      if (isWorkspaceRootForLinter) continue; // nested dirs are the apps for L
      if (!appLinters.has(entry.dir)) appLinters.set(entry.dir, new Set());
      appLinters.get(entry.dir).add(linter);
    }
  }

  const apps = [];
  for (const [dir, linterSet] of appLinters) {
    // A biome.json is an explicit choice of Biome over ESLint for JS/TS —
    // honor it by dropping the default ESLint binding for that app.
    let linters = [...linterSet];
    if (linters.includes('biome') && linters.includes('eslint')) {
      linters = linters.filter((l) => l !== 'eslint');
    }
    if (linters.length) apps.push({ appPath: dir, linters: linters.sort() });
  }

  return apps.sort((a, b) => a.appPath.localeCompare(b.appPath));
}

/**
 * Discovery warnings — surfaced by `migrate` / `baseline` so a guessed app
 * layout is visible rather than silent. The ambiguous case is a repo-root
 * linter config AND nested apps: discovery has to guess the boundary, so an
 * explicit `apps` map should pin it.
 * @returns {string[]}
 */
function discoveryWarnings(projectRoot, opts = {}) {
  const apps = discoverApps(projectRoot, opts);
  const warnings = [];
  const hasRootApp = apps.some((a) => a.appPath === '.');
  if (hasRootApp && apps.length > 1) {
    warnings.push(
      'Discovery found a repo-root linter config AND nested app(s); the app ' +
        'boundaries are a guess. Pin them with an explicit `apps` map in ' +
        'gimme-the-lint.config.js (migrate writes one for you).'
    );
  }
  return warnings;
}

module.exports = {
  discoverApps,
  discoveryWarnings,
  findManifestDirs,
  globToRegExp,
  MANIFEST_LINTERS,
  DEFAULT_SKIP_PATTERNS,
};
