'use strict';

const chalk = require('chalk');
const gtlManifest = require('./gtl-manifest');
const drift = require('./drift');
const gitHooks = require('./git-hooks-manager');

// The dashboard renders the global manifest plus per-app drift — the answer
// to "what is baselined, and has anything moved since?". Backs both
// `gimme-the-lint dashboard` and the /lint:status slash command.

const RULE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

/** Build the dashboard string for a project. */
async function formatDashboard(projectRoot) {
  const root = projectRoot || process.cwd();
  const manifest = await gtlManifest.readManifest(root);

  const lines = [
    chalk.cyan(RULE),
    chalk.cyan('gimme-the-lint: Progressive Linting Dashboard'),
    chalk.cyan(RULE),
  ];

  // Surfaced before anything else: every line below describes what the engine
  // WOULD check. A stale hook means some of it is not actually running, which
  // makes the rest of this dashboard misleading rather than merely incomplete.
  const hookStatus = await gitHooks.getStatus(root);
  if (hookStatus.stale && hookStatus.stale.length) {
    lines.push(
      chalk.yellow(
        `⚠ ${hookStatus.stale.join(' and ')} hook(s) predate this version — they will ` +
          'NOT run the newer checks.'
      )
    );
    lines.push(chalk.blue('  Fix: gimme-the-lint hooks'));
    lines.push('');
  }
  // Hooks git never executes look exactly like hooks git runs. Say which.
  if (hookStatus.orphaned && hookStatus.orphaned.length) {
    lines.push(
      chalk.red(
        `⚠ ${hookStatus.orphaned.join(' and ')} hook(s) in .git/hooks are NEVER RUN — ` +
          'core.hooksPath points elsewhere. They guard nothing.'
      )
    );
    lines.push(chalk.blue('  Fix: gimme-the-lint hooks'));
    lines.push('');
  }

  if (!manifest) {
    lines.push(chalk.yellow('No baseline yet — run: gimme-the-lint baseline'));
    return lines.join('\n');
  }

  const apps = Object.keys(manifest.apps || {}).sort();
  lines.push(chalk.dim(`Updated: ${manifest.updated_at}`));
  lines.push(chalk.dim(`Apps:    ${apps.length}`));
  lines.push('');

  for (const appPath of apps) {
    lines.push(chalk.cyan(`  ${appPath}`));
    const linters = manifest.apps[appPath].linters || {};
    for (const [linterId, info] of Object.entries(linters)) {
      if (info.status === 'skipped') {
        lines.push(
          `    ${chalk.yellow('⚠')} ${linterId} — ${chalk.yellow('skipped (linter not installed)')}`
        );
      } else if (info.status === 'clean') {
        lines.push(`    ${chalk.green('✓')} ${linterId} — ${chalk.dim('clean (no baseline needed)')}`);
      } else {
        lines.push(
          `    ${chalk.green('✓')} ${linterId} — ${info.total} baselined ` +
            chalk.dim(`· ${linterId} ${info.tool_version}`)
        );
      }
    }
  }

  lines.push('');
  const driftResult = await drift.detectDrift(root);
  const driftReport = drift.formatDriftReport(driftResult);
  if (driftReport) {
    lines.push(chalk.yellow(driftReport));
    lines.push('');
    lines.push(chalk.blue('Tip: refresh baselines — gimme-the-lint baseline'));
  } else {
    lines.push(chalk.green('No drift detected — baselines are current.'));
  }

  return lines.join('\n');
}

module.exports = { formatDashboard };
