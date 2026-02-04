'use strict';

const fs = require('fs-extra');
const path = require('path');
const configManager = require('./config-manager');
const venvManager = require('./venv-manager');
const gitHooksManager = require('./git-hooks-manager');

async function init(projectRoot, options = {}) {
  const results = { steps: [], errors: [] };

  // Step 1: Detect project type
  const projectType = await configManager.detectProjectType(projectRoot);
  results.projectType = projectType;
  results.steps.push(`Detected project type: ${projectType}`);

  const enableFrontend = options.frontend !== false && (projectType === 'monorepo' || projectType === 'frontend');
  const enableBackend = options.backend !== false && (projectType === 'monorepo' || projectType === 'backend');

  // Step 2: Create config file
  const configResult = await configManager.initConfig(projectRoot, {
    force: options.force,
    frontendDir: options.frontendDir,
    backendDir: options.backendDir,
  });
  results.steps.push(configResult.created ? 'Created gimme-the-lint.config.js' : 'Config already exists');

  // Step 3: Copy ESLint template (frontend)
  if (enableFrontend) {
    const frontendDir = path.join(projectRoot, options.frontendDir || 'frontend');
    const eslintDest = path.join(frontendDir, 'eslint.config.js');

    if (!await fs.pathExists(eslintDest) || options.force) {
      try {
        await configManager.copyTemplate('eslint.config.template.js', eslintDest, {
          REACT_VERSION: options.reactVersion || '18.3',
        });
        results.steps.push('Created eslint.config.js template');
      } catch (e) {
        results.errors.push(`ESLint template: ${e.message}`);
      }
    }
  }

  // Step 4: Copy pyproject.toml template (backend)
  if (enableBackend) {
    const pyprojectDest = path.join(projectRoot, 'pyproject.toml');
    if (!await fs.pathExists(pyprojectDest) || options.force) {
      try {
        await configManager.copyTemplate('pyproject.template.toml', pyprojectDest, {
          PROJECT_NAME: path.basename(projectRoot),
        });
        results.steps.push('Created pyproject.toml with Ruff config');
      } catch (e) {
        results.errors.push(`pyproject.toml template: ${e.message}`);
      }
    }
  }

  // Step 5: Copy gitleaks template
  const gitleaksDest = path.join(projectRoot, '.gitleaks.toml');
  if (!await fs.pathExists(gitleaksDest) || options.force) {
    try {
      await configManager.copyTemplate('.gitleaks.template.toml', gitleaksDest);
      results.steps.push('Created .gitleaks.toml');
    } catch (e) {
      results.errors.push(`gitleaks template: ${e.message}`);
    }
  }

  // Step 6: Copy pre-commit config
  const precommitDest = path.join(projectRoot, '.pre-commit-config.yaml');
  if (!await fs.pathExists(precommitDest) || options.force) {
    try {
      await configManager.copyTemplate('.pre-commit-config.template.yaml', precommitDest);
      results.steps.push('Created .pre-commit-config.yaml');
    } catch (e) {
      results.errors.push(`pre-commit template: ${e.message}`);
    }
  }

  // Step 7: Copy commitlint config
  const commitlintDest = path.join(projectRoot, 'commitlint.config.js');
  if (!await fs.pathExists(commitlintDest) || options.force) {
    try {
      await configManager.copyTemplate('commitlint.config.template.js', commitlintDest);
      results.steps.push('Created commitlint.config.js');
    } catch (e) {
      results.errors.push(`commitlint template: ${e.message}`);
    }
  }

  // Step 8: Setup Python venv (backend)
  if (enableBackend && options.setupVenv !== false) {
    try {
      const { pythonVersion } = venvManager.createVenv(projectRoot);
      results.steps.push(`Created Python venv (${pythonVersion})`);

      const reqFile = path.join(__dirname, '..', 'templates', 'requirements.linting.txt');
      venvManager.installDeps(projectRoot, reqFile);
      results.steps.push('Installed linting dependencies (ruff, mypy)');
    } catch (e) {
      results.errors.push(`Python venv: ${e.message}`);
    }
  }

  return results;
}

module.exports = { init };
