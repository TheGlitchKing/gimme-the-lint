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
  .option('--offline', 'Air-gapped install: no npm/pip fetches; toolchain assumed present')
  .option('--no-baseline', 'Greenfield: write empty baselines (strict from day one)')
  .action(async (opts) => {
    const installer = require('../lib/installer');
    const chalk = require('chalk');

    console.log(chalk.blue('\ngimme-the-lint: Installing progressive linting system...\n'));

    try {
      const result = await installer.init(process.cwd(), {
        frontend: opts.frontend !== undefined ? true : undefined,
        backend: opts.backend !== undefined ? true : undefined,
        force: opts.force,
        offline: opts.offline,
        // commander sets opts.baseline=false when --no-baseline is passed.
        noBaseline: opts.baseline === false,
      });

      for (const step of result.steps) {
        console.log(chalk.green('  ✓ ') + step);
      }
      for (const err of result.errors) {
        console.log(chalk.yellow('  ⚠ ') + err);
      }

      // Offline preflight gaps are a hard failure: provisioning is broken.
      if (result.offlineGaps && result.offlineGaps.length > 0) {
        console.error(
          chalk.red(
            `\n✗ Offline install: ${result.offlineGaps.length} linter(s) missing for present code.`
          )
        );
        console.error(chalk.red('  Provision the toolchain (CodeArtifact / AMI) and retry.\n'));
        process.exit(1);
      }

      console.log(chalk.green('\n✓ Installation complete!\n'));
      console.log('Next steps:');
      console.log('  gimme-the-lint baseline     Capture progressive-lint baselines');
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
  .option('--offline', 'Air-gapped install: no npm/pip fetches; toolchain assumed present')
  .option('--no-baseline', 'Greenfield: write empty baselines (strict from day one)')
  .action(async (opts) => {
    // Delegate to install, forwarding every flag.
    const args = ['node', 'cmd'];
    if (opts.frontend) args.push('--frontend');
    if (opts.backend) args.push('--backend');
    if (opts.force) args.push('--force');
    if (opts.offline) args.push('--offline');
    if (opts.baseline === false) args.push('--no-baseline');
    await program.commands.find((c) => c.name() === 'install').parseAsync(args);
  });

program
  .command('check')
  .description('Run progressive linting checks (only NEW violations block)')
  .option('--fix', 'Auto-fix violations where the linter supports it')
  .option('--all', 'Lint the entire codebase, not just staged changes')
  .option('--strict', 'Fail when a linter is missing for code that is present')
  .action(async (opts) => {
    const chalk = require('chalk');
    const { runCheck } = require('../lib/check');
    const { formatCheckReport } = require('../lib/report');
    try {
      const report = await runCheck(process.cwd(), {
        fix: opts.fix,
        changedOnly: !opts.all,
        strict: opts.strict,
      });
      console.log(formatCheckReport(report));
      process.exit(report.ok ? 0 : 1);
    } catch (err) {
      console.error(chalk.red(`\n✗ ${err.message}\n`));
      process.exit(1);
    }
  });

program
  .command('baseline [target]')
  .description('Create or refresh progressive-lint baselines')
  .option('--strict', 'Fail when a linter is missing for code that is present')
  .option('--empty', 'Write empty baselines (greenfield: treat every violation as new)')
  .action(async (target, opts) => {
    const chalk = require('chalk');
    const { runBaseline } = require('../lib/baseline');
    const { formatBaselineReport } = require('../lib/report');
    // [target] is accepted for backward compatibility; v2 baselines every unit.
    try {
      const report = await runBaseline(process.cwd(), {
        strict: opts.strict,
        noBaseline: opts.empty,
      });
      console.log(formatBaselineReport(report, process.cwd()));
      console.log('');
    } catch (err) {
      console.error(chalk.red(`\n✗ ${err.message}\n`));
      process.exit(1);
    }
  });

program
  .command('dashboard')
  .description('Show the progressive linting dashboard (baselines + drift)')
  .action(async () => {
    const { formatDashboard } = require('../lib/dashboard');
    console.log(await formatDashboard(process.cwd()));
    console.log('');
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

// Runtime-provided subcommands: update, policy, status, relink.
// Loaded dynamically because the runtime is ESM and this file is CJS.
(async () => {
  try {
    const { registerUpdateCommands } = await import('@theglitchking/claude-plugin-runtime');
    registerUpdateCommands(program, {
      packageName: '@theglitchking/gimme-the-lint',
      pluginName: 'gimme-the-lint',
      configFile: 'gimme-the-lint.json',
    });
  } catch (err) {
    // Runtime not available — degrade silently; existing subcommands still work.
  }

  program.parse(process.argv);

  if (!process.argv.slice(2).length) {
    program.help();
  }
})();
