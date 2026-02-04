'use strict';

const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

function getPythonCmd() {
  for (const cmd of ['python3', 'python']) {
    try {
      const version = execSync(`${cmd} --version`, { encoding: 'utf8' }).trim();
      const match = version.match(/(\d+)\.(\d+)/);
      if (match && parseInt(match[1]) >= 3 && parseInt(match[2]) >= 8) {
        return { cmd, version };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function getVenvPath(projectRoot) {
  return path.join(projectRoot, '.venv');
}

function isVenvActive(projectRoot) {
  const venvPath = getVenvPath(projectRoot);
  const activatePath = path.join(venvPath, 'bin', 'activate');
  return fs.existsSync(activatePath);
}

function createVenv(projectRoot) {
  const python = getPythonCmd();
  if (!python) {
    throw new Error('Python 3.8+ not found. Please install Python 3.8 or later.');
  }

  const venvPath = getVenvPath(projectRoot);

  if (!fs.existsSync(venvPath)) {
    execSync(`${python.cmd} -m venv "${venvPath}"`, { cwd: projectRoot, stdio: 'inherit' });
  }

  return { venvPath, pythonVersion: python.version };
}

function installDeps(projectRoot, depsFile) {
  const venvPath = getVenvPath(projectRoot);
  const pip = path.join(venvPath, 'bin', 'pip');

  execSync(`"${pip}" install --quiet --upgrade pip`, { cwd: projectRoot, stdio: 'inherit' });

  if (depsFile && fs.existsSync(depsFile)) {
    execSync(`"${pip}" install --quiet -r "${depsFile}"`, { cwd: projectRoot, stdio: 'inherit' });
  }
}

function runInVenv(projectRoot, command) {
  const venvPath = getVenvPath(projectRoot);
  const activate = path.join(venvPath, 'bin', 'activate');
  return execSync(`source "${activate}" && ${command}`, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: '/bin/bash',
  });
}

function getStatus(projectRoot) {
  const venvPath = getVenvPath(projectRoot);
  const exists = fs.existsSync(venvPath);
  let ruffVersion = null;
  let pythonVersion = null;

  if (exists) {
    try {
      ruffVersion = runInVenv(projectRoot, 'ruff --version').trim();
    } catch { /* not installed */ }
    try {
      pythonVersion = runInVenv(projectRoot, 'python --version').trim();
    } catch { /* not available */ }
  }

  return { exists, path: venvPath, ruffVersion, pythonVersion };
}

module.exports = {
  getPythonCmd,
  getVenvPath,
  isVenvActive,
  createVenv,
  installDeps,
  runInVenv,
  getStatus,
};
