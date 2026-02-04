#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');

const pkg = require('../package.json');

const program = new Command();
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');

function runScript(name, args = '') {
  const script = path.join(SCRIPTS_DIR, name);
  try {
    execSync(`bash "${script}" ${args}`, { stdio: 'inherit', cwd: process.cwd() });
  } catch (e) {
    process.exit(e.status || 1);
  }
}

program
  .name('gimme-the-lint')
  .description(pkg.description)
  .version(pkg.version);

program
  .command('install')
  .description('Install gimme-the-lint into the current project')
  .option('--scope <scope>', 'Installation scope: project or user', 'project')
  .option('--frontend', 'Frontend only')
  .option('--backend', 'Backend only')
  .option('--force', 'Overwrite existing configs')
  .action(async (opts) => {
    const installer = require('../lib/installer');
    const chalk = require('chalk');

    console.log(chalk.blue('\ngimme-the-lint: Installing progressive linting system...\n'));

    try {
      const result = await installer.init(process.cwd(), {
        frontend: opts.frontend !== undefined ? true : undefined,
        backend: opts.backend !== undefined ? true : undefined,
        force: opts.force,
      });

      for (const step of result.steps) {
        console.log(chalk.green('  ✓ ') + step);
      }
      for (const err of result.errors) {
        console.log(chalk.yellow('  ⚠ ') + err);
      }

      console.log(chalk.green('\n✓ Installation complete!\n'));
      console.log('Next steps:');
      console.log('  gimme-the-lint baseline     Create LTTF baselines');
      console.log('  gimme-the-lint hooks        Install git hooks');
      console.log('  gimme-the-lint dashboard    View linting status');
      console.log('');
    } catch (e) {
      console.error(chalk.red(`\n✗ Installation failed: ${e.message}\n`));
      process.exit(1);
    }
  });

program
  .command('uninstall')
  .description('Remove gimme-the-lint from the current project')
  .action(async () => {
    const chalk = require('chalk');
    const gitHooksManager = require('../lib/git-hooks-manager');

    console.log(chalk.blue('\ngimme-the-lint: Uninstalling...\n'));

    const removed = await gitHooksManager.uninstallHooks(process.cwd());
    if (removed.length > 0) {
      console.log(chalk.green(`  ✓ Removed git hooks: ${removed.join(', ')}`));
    }

    const configPath = path.join(process.cwd(), 'gimme-the-lint.config.js');
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
      console.log(chalk.green('  ✓ Removed gimme-the-lint.config.js'));
    }

    console.log(chalk.green('\n✓ Uninstall complete.\n'));
    console.log('Note: Baseline files, linter configs, and .venv were NOT removed.');
    console.log('Remove manually if desired.');
    console.log('');
  });

program
  .command('init')
  .description('Initialize linting configuration (alias for install)')
  .option('--frontend', 'Frontend only')
  .option('--backend', 'Backend only')
  .option('--force', 'Overwrite existing configs')
  .action(async (opts) => {
    // Delegate to install
    await program.commands.find((c) => c.name() === 'install').parseAsync(['node', 'cmd', ...(opts.frontend ? ['--frontend'] : []), ...(opts.backend ? ['--backend'] : []), ...(opts.force ? ['--force'] : [])]);
  });

program
  .command('check')
  .description('Run progressive linting checks')
  .option('--fix', 'Auto-fix violations')
  .option('--verbose', 'Show detailed output')
  .option('--frontend-only', 'Frontend only')
  .option('--backend-only', 'Backend only')
  .option('--all', 'Lint entire codebase')
  .action((opts) => {
    const args = [];
    if (opts.fix) args.push('--fix');
    if (opts.verbose) args.push('--verbose');
    if (opts.frontendOnly) args.push('--frontend-only');
    if (opts.backendOnly) args.push('--backend-only');
    if (opts.all) args.push('--all');
    runScript('run-checks.sh', args.join(' '));
  });

program
  .command('baseline [target]')
  .description('Create LTTF baselines (frontend, backend, or both)')
  .action((target) => {
    if (target === 'frontend') {
      runScript('eslint-baseline.sh');
    } else if (target === 'backend') {
      runScript('ruff-baseline.sh');
    } else {
      runScript('eslint-baseline.sh');
      runScript('ruff-baseline.sh');
    }
  });

program
  .command('dashboard')
  .description('Show progressive linting status dashboard')
  .action(() => {
    runScript('dashboard.sh');
  });

program
  .command('hooks')
  .description('Install git hooks for pre-commit linting')
  .action(async () => {
    const chalk = require('chalk');
    const gitHooksManager = require('../lib/git-hooks-manager');

    try {
      const installed = await gitHooksManager.installHooks(process.cwd());
      console.log(chalk.green(`\n✓ Installed git hooks: ${installed.join(', ')}\n`));
    } catch (e) {
      console.error(chalk.red(`\n✗ ${e.message}\n`));
      process.exit(1);
    }
  });

program
  .command('venv [action]')
  .description('Manage Python virtual environment (setup, status)')
  .action((action) => {
    if (action === 'status') {
      const venvManager = require('../lib/venv-manager');
      const chalk = require('chalk');
      const status = venvManager.getStatus(process.cwd());

      console.log(chalk.blue('\nPython Virtual Environment Status:\n'));
      console.log(`  Exists:  ${status.exists ? chalk.green('yes') : chalk.red('no')}`);
      console.log(`  Path:    ${status.path}`);
      if (status.pythonVersion) console.log(`  Python:  ${status.pythonVersion}`);
      if (status.ruffVersion) console.log(`  Ruff:    ${status.ruffVersion}`);
      console.log('');
    } else {
      runScript('setup-venv.sh');
    }
  });

program
  .command('status')
  .description('Show overall gimme-the-lint status')
  .action(async () => {
    const chalk = require('chalk');
    const venvManager = require('../lib/venv-manager');
    const gitHooksManager = require('../lib/git-hooks-manager');
    const configManager = require('../lib/config-manager');

    const projectRoot = process.cwd();
    const projectType = await configManager.detectProjectType(projectRoot);
    const venvStatus = venvManager.getStatus(projectRoot);
    const hookStatus = await gitHooksManager.getStatus(projectRoot);
    const configExists = fs.existsSync(path.join(projectRoot, 'gimme-the-lint.config.js'));

    console.log(chalk.blue('\ngimme-the-lint Status\n'));
    console.log(`  Project type:  ${projectType}`);
    console.log(`  Config:        ${configExists ? chalk.green('found') : chalk.yellow('not found')}`);
    console.log(`  Python venv:   ${venvStatus.exists ? chalk.green('active') : chalk.yellow('missing')}`);
    if (venvStatus.ruffVersion) console.log(`    Ruff:        ${venvStatus.ruffVersion}`);
    console.log(`  Git repo:      ${hookStatus.gitRepo ? chalk.green('yes') : chalk.red('no')}`);
    if (hookStatus.gitRepo) {
      for (const [hook, status] of Object.entries(hookStatus.hooks)) {
        const color = status === 'installed' ? chalk.green : status === 'other' ? chalk.yellow : chalk.red;
        console.log(`    ${hook}: ${color(status)}`);
      }
    }
    console.log('');
  });

program
  .command('help-text')
  .description('Show help')
  .action(() => {
    program.help();
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.help();
}
