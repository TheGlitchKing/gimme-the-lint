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
    const configManager = require('../lib/config-manager');

    console.log(chalk.blue('\ngimme-the-lint: Uninstalling...\n'));

    const removed = await gitHooksManager.uninstallHooks(process.cwd());
    if (removed.length > 0) {
      console.log(chalk.green(`  ✓ Removed git hooks: ${removed.join(', ')}`));
    }

    // Remove a repo-root config. A config under .gtl/ is left in place — it is
    // part of the .gtl/ directory, which uninstall preserves.
    const cfgPath = configManager.findConfig(process.cwd());
    if (cfgPath) {
      const rel = path.relative(process.cwd(), cfgPath);
      if (rel.startsWith(`.gtl${path.sep}`)) {
        console.log(chalk.dim(`  · Config kept (${rel} — part of .gtl/)`));
      } else {
        fs.unlinkSync(cfgPath);
        console.log(chalk.green(`  ✓ Removed ${path.basename(cfgPath)}`));
      }
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
  .option(
    '--stage <stage>',
    'Which checks to run: "commit" (fast, default) or "push" (adds slower whole-app checks)',
    'commit'
  )
  .option(
    '--no-stale-baseline',
    'Fail if the baseline grandfathers violations that no longer occur (needs --all: ' +
      'a scoped run cannot tell a fixed violation from a file it never opened)'
  )
  .action(async (opts) => {
    const chalk = require('chalk');
    const { runCheck } = require('../lib/check');
    const { formatCheckReport } = require('../lib/report');
    try {
      const report = await runCheck(process.cwd(), {
        fix: opts.fix,
        changedOnly: !opts.all,
        strict: opts.strict,
        stage: opts.stage,
        // commander maps `--no-stale-baseline` to staleBaseline === false
        noStaleBaseline: opts.staleBaseline === false,
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
  .option('--allow-incomplete', 'Exit 0 even if some linters could not be baselined')
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
      // A baseline that could not capture a linter is incomplete — fail loudly
      // rather than reporting success, unless the user opts in.
      if (report.incomplete && report.incomplete.length && !opts.allowIncomplete) {
        console.error(
          chalk.red(
            `✗ Baseline INCOMPLETE — ${report.incomplete.length} linter(s) not captured. ` +
              'Install them and re-run, or pass --allow-incomplete.\n'
          )
        );
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red(`\n✗ ${err.message}\n`));
      process.exit(1);
    }
  });

program
  .command('migrate')
  .description('Migrate a v1 (.lttf) project to the v2 .gtl/ layout')
  .option('--strict', 'Fail when a linter is missing for code that is present')
  .option('--allow-incomplete', 'Exit 0 even if some linters could not be baselined')
  .option('--rules', 'Migrate baselines through rule renames/removals (no layout change)')
  .action(async (opts) => {
    const chalk = require('chalk');
    const { migrate, migrateRules } = require('../lib/migrate');

    // --rules: rewrite baseline fingerprints through the per-linter rule-alias
    // maps. A standalone mode — it does not touch the .gtl/ layout.
    if (opts.rules) {
      try {
        const result = await migrateRules(process.cwd());
        if (!result.migrated) {
          console.log(
            chalk.yellow('\nNo rule migrations applied — baselines are up to date.\n')
          );
          return;
        }
        console.log(chalk.green('\n✓ Rule migration applied\n'));
        for (const u of result.units) {
          for (const l of u.linters) {
            const renames = l.renamed
              .map((r) => `${r.from}→${r.to}`)
              .join(', ');
            console.log(
              `  ${u.app} · ${l.linter}: ` +
                `${l.renamed.length} renamed${renames ? ` (${renames})` : ''}, ` +
                `${l.dropped} dropped`
            );
          }
        }
        console.log('');
        console.log('Review the updated .gtl/ baselines and commit them.');
        console.log('');
      } catch (err) {
        console.error(chalk.red(`\n✗ Rule migration failed: ${err.message}\n`));
        process.exit(1);
      }
      return;
    }

    try {
      const result = await migrate(process.cwd(), { strict: opts.strict });
      if (!result.migrated) {
        console.log(chalk.yellow(`\n${result.reason}\n`));
        return;
      }
      console.log(chalk.green('\n✓ Migrated to the v2 .gtl/ layout\n'));
      console.log(`  Legacy baselines backed up: ${result.backedUp.join(', ')}`);
      console.log(chalk.dim(`    → ${result.backupPath}`));
      if (result.appsConfig && result.appsConfig.created) {
        console.log(
          `  Wrote explicit app map → ${path.basename(result.appsConfig.path)}`
        );
      }
      console.log(`  Re-baselined ${result.baseline.unitCount} app(s) into .gtl/`);
      for (const w of result.discoveryWarnings || []) {
        console.log(chalk.yellow(`  ⚠ ${w}`));
      }
      console.log('');

      // An incomplete baseline must never be reported as a clean migration.
      if (result.incomplete && result.incomplete.length) {
        console.error(
          chalk.red(`✗ ${result.incomplete.length} linter(s) were NOT baselined:`)
        );
        for (const i of result.incomplete) {
          console.error(chalk.red(`    ${i.app} · ${i.linter} (${i.status})`));
        }
        console.error(
          chalk.yellow(
            '  The baseline is INCOMPLETE — install the missing linters and run\n' +
              '  `gimme-the-lint baseline`, then commit .gtl/.'
          )
        );
        if (!opts.allowIncomplete) {
          console.error(
            chalk.red(
              '\n✗ Migration finished with an incomplete baseline ' +
                '(pass --allow-incomplete to accept).\n'
            )
          );
          process.exit(1);
        }
        console.log('');
      }

      console.log(
        'Next: review the new .gtl/ directory and gimme-the-lint.config.js, then commit them.'
      );
      console.log('');
    } catch (err) {
      console.error(chalk.red(`\n✗ Migration failed: ${err.message}\n`));
      process.exit(1);
    }
  });

program
  .command('verify')
  .description('Run the checks that need a database or network (CI only — never a git hook)')
  .option('--offline', 'Air-gapped: fail rather than silently skip external checks')
  .action(async (opts) => {
    const chalk = require('chalk');
    const { runVerify } = require('../lib/verify');
    const { formatCheckReport } = require('../lib/report');

    // Deliberately its own command rather than a flag on `check`. A flag can be
    // passed by accident, and an invariant that depends on nobody passing a flag is
    // not an invariant. `check` is a git hook and must stay hermetic; this is where
    // the database-touching checks live, in CI, where credentials legitimately do.
    try {
      const report = await runVerify(process.cwd(), { offline: opts.offline });
      console.log(formatCheckReport(report));
      process.exit(report.ok ? 0 : 1);
    } catch (err) {
      if (err.code === 'OFFLINE_EXTERNAL') {
        // Fail closed. A silent skip here would let a CI job go green having verified
        // nothing at all — a provisioning bug, wearing the costume of a passing build.
        console.error(chalk.red(`\n✗ ${err.message}\n`));
        process.exit(1);
      }
      console.error(chalk.red(`\n✗ ${err.message}\n`));
      process.exit(1);
    }
  });

program
  .command('materialize')
  .description('Write down the API contract your code computes at runtime (openapi.json)')
  .action(async () => {
    const chalk = require('chalk');
    const fs = require('fs-extra');
    const path = require('path');
    const { resolveUnits } = require('../lib/units');
    const adapters = require('../lib/adapters');

    // The ONLY command that writes a lockfile into the working tree. `check` never
    // does — a hook that edits your files behind your back is a hostile hook — and
    // `baseline` has no business touching source. One command, one code path, so
    // "what could have written this?" always has one answer.
    const root = process.cwd();
    let wrote = 0;

    console.log(chalk.blue('\ngimme-the-lint: materialize\n'));

    for (const unit of resolveUnits(root)) {
      // REGISTRY ORDER, not the unit's (sorted) linter list.
      //
      // Derivation is a chain: the lockfile is derived from the app, and the client types
      // are derived from the lockfile. Run them alphabetically — `codegen-drift` sorts
      // before `openapi` — and we would generate the types from YESTERDAY's lockfile,
      // then overwrite the lockfile, and report success. The command whose entire job is
      // to make the types fresh would be the thing that staled them.
      for (const linterId of adapters.materializeOrder(unit.linters)) {
        let adapter;
        try {
          adapter = adapters.getAdapter(linterId, {
            projectRoot: root,
            appRoot: unit.root,
          });
        } catch {
          continue;
        }
        if (!adapter.detect(unit.root) || !adapter.available()) continue;

        let result;
        try {
          result = adapter.materialize();
        } catch (err) {
          console.log(`  ${chalk.red('✗')} ${unit.id} · ${linterId} — ${err.message}`);
          continue;
        }
        if (!result) continue; // this adapter derives nothing. Most do not.

        // Provenance: a file we did not write is somebody's hand-authored source of
        // truth, and regenerating over it would destroy their work on a routine
        // command. The adapter refuses; we report and move on.
        if (result.skipped) {
          console.log(`  ${chalk.yellow('·')} ${unit.id} · ${linterId}`);
          console.log(chalk.yellow(`      ${result.skipped}`));
          continue;
        }

        const existing = (await fs.pathExists(result.path))
          ? await fs.readFile(result.path, 'utf8')
          : null;

        if (existing === result.content) {
          console.log(
            `  ${chalk.dim('·')} ${unit.id} · ${linterId} ${chalk.dim('— already current')}`
          );
          continue;
        }

        await fs.ensureDir(path.dirname(result.path));
        await fs.writeFile(result.path, result.content);
        wrote += 1;
        console.log(
          `  ${chalk.green('✓')} ${unit.id} · ${linterId} → ` +
            chalk.cyan(path.relative(root, result.path))
        );
      }
    }

    console.log('');
    if (wrote > 0) {
      console.log(chalk.blue('Commit the lockfile — it is what makes a breaking API'));
      console.log(chalk.blue('change visible in a pull request instead of in production.'));
    } else {
      console.log(chalk.dim('Nothing to write.'));
    }
    console.log('');
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
  .option('--force', 'Install even when the baseline is incomplete')
  .action(async (opts) => {
    const chalk = require('chalk');
    const gitHooksManager = require('../lib/git-hooks-manager');
    const { findIncompleteBaselines } = require('../lib/baseline');

    try {
      // Refuse to gate commits against an incomplete baseline: hooks would
      // diff against linter sections that were never captured, so every
      // pre-existing violation would count as new and block the commit.
      const incomplete = await findIncompleteBaselines(process.cwd());
      if (incomplete.length && !opts.force) {
        console.error(
          chalk.red('\n✗ Refusing to install hooks — the baseline is incomplete:\n')
        );
        for (const i of incomplete) {
          console.error(chalk.red(`    ${i.app} · ${i.linter} (${i.status})`));
        }
        console.error(
          chalk.yellow(
            '\n  These linters were never baselined, so a pre-commit hook would\n' +
              '  flag every pre-existing violation as new. Install the missing\n' +
              '  linters and run `gimme-the-lint baseline`, or pass --force.\n'
          )
        );
        process.exit(1);
      }

      const installed = await gitHooksManager.installHooks(process.cwd());
      console.log(chalk.green(`\n✓ Installed git hooks: ${installed.join(', ')}\n`));
      if (incomplete.length && opts.force) {
        console.log(
          chalk.yellow(
            '⚠ Installed against an INCOMPLETE baseline (--force) — re-baseline soon.\n'
          )
        );
      }
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
    const configExists = Boolean(configManager.findConfig(projectRoot));

    console.log(chalk.blue('\ngimme-the-lint Status\n'));
    console.log(`  Project type:  ${projectType}`);
    console.log(`  Config:        ${configExists ? chalk.green('found') : chalk.yellow('not found')}`);
    console.log(`  Python venv:   ${venvStatus.exists ? chalk.green('active') : chalk.yellow('missing')}`);
    if (venvStatus.ruffVersion) console.log(`    Ruff:        ${venvStatus.ruffVersion}`);
    console.log(`  Git repo:      ${hookStatus.gitRepo ? chalk.green('yes') : chalk.red('no')}`);
    if (hookStatus.gitRepo) {
      for (const [hook, status] of Object.entries(hookStatus.hooks)) {
        const color =
          status === 'installed'
            ? chalk.green
            : status === 'stale' || status === 'other'
              ? chalk.yellow
              : chalk.red;
        console.log(`    ${hook}: ${color(status)}`);
      }
    }
    // A stale hook still passes, still looks installed, and quietly runs fewer
    // checks than the engine now provides. Say so loudly — a silent under-check
    // is indistinguishable from a clean bill of health.
    if (hookStatus.stale && hookStatus.stale.length) {
      console.log('');
      console.log(
        chalk.yellow(
          `⚠ ${hookStatus.stale.join(' and ')} hook(s) are from an older version of ` +
            'gimme-the-lint.'
        )
      );
      console.log(
        chalk.yellow('  They still run, but will NOT run the checks added in this release.')
      );
      console.log(chalk.blue('  Fix: gimme-the-lint hooks'));
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
