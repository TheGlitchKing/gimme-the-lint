'use strict';

const fs = require('fs-extra');
const path = require('path');
const configManager = require('./config-manager');
const venvManager = require('./venv-manager');
const gitHooksManager = require('./git-hooks-manager');
const toolchain = require('./toolchain');
const { runBaseline } = require('./baseline');

// init() supports two adoption modes beyond the default:
//   options.offline    — air-gapped install: no npm/pip fetches; assumes the
//                        linter toolchain is already provisioned, and fails
//                        loudly (offlineGaps) if it is not.
//   options.noBaseline — greenfield "strict from day one": writes EMPTY
//                        baselines and installs hooks, so every violation is
//                        new and nothing is grandfathered.
async function init(projectRoot, options = {}) {
  const results = { steps: [], errors: [], offlineGaps: [] };

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
  results.steps.push(configResult.created ? `Created ${path.basename(configResult.path)}` : 'Config already exists');

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

  // Step 8: Setup Python venv (backend) — skipped entirely in offline mode,
  // where the toolchain is provisioned outside gimme-the-lint.
  if (options.offline) {
    results.steps.push(
      'Offline mode: skipped npm/pip setup (toolchain assumed pre-provisioned)'
    );
  } else if (enableBackend && options.setupVenv !== false) {
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

  // Step 9: Greenfield mode — write empty baselines and install hooks so the
  // project is "strict from day one" with nothing grandfathered.
  if (options.noBaseline) {
    try {
      const report = await runBaseline(projectRoot, { noBaseline: true });
      results.steps.push(
        `Greenfield mode: wrote empty baselines for ${report.unitCount} app(s)`
      );
    } catch (e) {
      results.errors.push(`Greenfield baseline: ${e.message}`);
    }
    try {
      const hooks = await gitHooksManager.installHooks(projectRoot);
      if (hooks.length) {
        results.steps.push(`Installed git hooks: ${hooks.join(', ')}`);
      }
    } catch (e) {
      results.errors.push(`Git hooks: ${e.message}`);
    }
  }

  // Step 10: Offline preflight — a present language with no linter binary is
  // a provisioning bug; surface it loudly rather than silently skipping.
  if (options.offline) {
    results.offlineGaps = toolchain.findGaps(projectRoot);
    for (const gap of results.offlineGaps) {
      results.errors.push(
        `OFFLINE: ${gap.linter} not found for "${gap.app}" — provision it ` +
          '(CodeArtifact / pre-baked AMI) before linting'
      );
    }
  }

  return results;
}

module.exports = { init };
