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

// Manifest filename → linter id.
const MANIFEST_LINTERS = {
  'package.json': 'eslint',
  'biome.json': 'biome',
  'biome.jsonc': 'biome',
  'pyproject.toml': 'ruff',
  'setup.py': 'ruff',
  'requirements.txt': 'ruff',
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
      if (entry.isFile() && MANIFEST_LINTERS[entry.name]) {
        linters.add(MANIFEST_LINTERS[entry.name]);
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
 * Discover the apps in a project.
 * An "app" is a LEAF manifest directory — one with no manifest-bearing
 * directory beneath it. A manifest dir that DOES contain nested packages is a
 * workspace root (npm/pnpm/nx/lerna) and is not itself linted; its packages
 * are. Workspace globs need no special parsing because each package carries
 * its own manifest.
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
  const allDirs = manifestDirs.map((m) => m.dir);

  const apps = [];
  for (const entry of manifestDirs) {
    const childPrefix = entry.dir === '.' ? '' : `${entry.dir}/`;
    const isWorkspaceRoot = allDirs.some(
      (other) => other !== entry.dir && other.startsWith(childPrefix)
    );
    if (isWorkspaceRoot) continue;

    // Skip template/scaffold directories (match any path segment).
    const segments = entry.dir === '.' ? [] : entry.dir.split('/');
    if (segments.some((segment) => matchesAny(segment, skipPatterns))) continue;

    // A biome.json is an explicit choice of Biome over ESLint for JS/TS —
    // honor it by dropping the default ESLint binding for that app.
    let linters = [...entry.linters];
    if (linters.includes('biome') && linters.includes('eslint')) {
      linters = linters.filter((l) => l !== 'eslint');
    }

    apps.push({ appPath: entry.dir, linters: linters.sort() });
  }

  return apps.sort((a, b) => a.appPath.localeCompare(b.appPath));
}

module.exports = {
  discoverApps,
  findManifestDirs,
  globToRegExp,
  MANIFEST_LINTERS,
  DEFAULT_SKIP_PATTERNS,
};
