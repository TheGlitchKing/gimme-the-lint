'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TEST_PATTERNS = [/test/i, /^__pycache__$/, /^e2e$/, /^\./, /^node_modules$/];

function isTestDir(name) {
  return TEST_PATTERNS.some((p) => p.test(name));
}

function discoverDirs(basePath, options = {}) {
  const { excludePatterns = [], maxDepth = 1 } = options;
  const allPatterns = [...TEST_PATTERNS, ...excludePatterns.map((p) => new RegExp(p, 'i'))];

  if (!fs.existsSync(basePath)) {
    return [];
  }

  const entries = fs.readdirSync(basePath, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .filter((e) => !allPatterns.some((p) => p.test(e.name)))
    .map((e) => e.name)
    .sort();
}

function discoverFrontendDirs(projectRoot, options = {}) {
  const srcPath = path.join(projectRoot, options.frontendDir || 'frontend', options.srcDir || 'src');
  return discoverDirs(srcPath, {
    excludePatterns: options.excludePatterns || [],
  });
}

function discoverBackendDirs(projectRoot, options = {}) {
  const appPath = path.join(projectRoot, options.backendDir || 'backend', options.appDir || 'app');
  return discoverDirs(appPath, {
    excludePatterns: options.excludePatterns || [],
  });
}

function getChangedDirs(projectRoot, options = {}) {
  const frontendPrefix = (options.frontendDir || 'frontend') + '/' + (options.srcDir || 'src') + '/';
  const backendPrefix = (options.backendDir || 'backend') + '/' + (options.appDir || 'app') + '/';

  let diff;
  try {
    diff = execSync('git diff --cached --name-only --diff-filter=ACMR', {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    return { frontend: [], backend: [], all: [] };
  }

  if (!diff) {
    return { frontend: [], backend: [], all: [] };
  }

  const files = diff.split('\n');
  const frontendDirs = new Set();
  const backendDirs = new Set();

  for (const file of files) {
    if (file.startsWith(frontendPrefix)) {
      const rest = file.slice(frontendPrefix.length);
      const dir = rest.split('/')[0];
      if (dir && !isTestDir(dir)) frontendDirs.add(dir);
    } else if (file.startsWith(backendPrefix)) {
      const rest = file.slice(backendPrefix.length);
      const dir = rest.split('/')[0];
      if (dir && !isTestDir(dir)) backendDirs.add(dir);
    }
  }

  return {
    frontend: Array.from(frontendDirs).sort(),
    backend: Array.from(backendDirs).sort(),
    all: files,
  };
}

function getChangedFiles(projectRoot, options = {}) {
  let diff;
  try {
    diff = execSync('git diff --cached --name-only --diff-filter=ACMR', {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    return { frontend: [], backend: [] };
  }

  if (!diff) {
    return { frontend: [], backend: [] };
  }

  const files = diff.split('\n');
  const frontendPrefix = (options.frontendDir || 'frontend') + '/';
  const backendPrefix = (options.backendDir || 'backend') + '/';

  const frontend = files.filter(
    (f) => f.startsWith(frontendPrefix) && /\.(js|jsx|ts|tsx)$/.test(f)
  );
  const backend = files.filter(
    (f) => f.startsWith(backendPrefix) && /\.py$/.test(f)
  );

  return { frontend, backend };
}

module.exports = {
  discoverDirs,
  discoverFrontendDirs,
  discoverBackendDirs,
  getChangedDirs,
  getChangedFiles,
  isTestDir,
};
