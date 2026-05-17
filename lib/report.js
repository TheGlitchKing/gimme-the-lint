'use strict';

const path = require('path');
const chalk = require('chalk');

// Presentation layer: turns the structured results from check.js / baseline.js
// into human- and LLM-readable terminal output. Kept separate so the engine
// stays pure and testable.

const RULE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
const MAX_LISTED = 20;

function formatViolation(v) {
  const loc = v.line ? `:${v.line}:${v.col || 0}` : '';
  return `    ${chalk.dim(v.file + loc)}  ${v.message} ${chalk.dim(`(${v.ruleId})`)}`;
}

/** Render a runCheck() report. */
function formatCheckReport(report) {
  const lines = [
    chalk.cyan(RULE),
    chalk.cyan('gimme-the-lint: Progressive Check'),
    chalk.cyan(RULE),
  ];

  if (report.legacyDetected) {
    lines.push(
      chalk.yellow('⚠ Legacy v1 baselines (.lttf/) detected — run: gimme-the-lint migrate')
    );
  }

  if (report.unitCount === 0) {
    lines.push(chalk.yellow('No lint units found — run: gimme-the-lint baseline'));
    return lines.join('\n');
  }

  for (const u of report.units) {
    const label = `${u.unit} · ${u.linter}`;
    if (u.status === 'pass') {
      lines.push(`${chalk.green('✓')} ${label} ${chalk.dim('— no new violations')}`);
    } else if (u.status === 'fail') {
      lines.push(
        `${chalk.red('✗')} ${label} ${chalk.red(`— ${u.diff.new.length} new violation(s)`)}`
      );
      for (const v of u.diff.new.slice(0, MAX_LISTED)) lines.push(formatViolation(v));
      if (u.diff.new.length > MAX_LISTED) {
        lines.push(chalk.dim(`    …and ${u.diff.new.length - MAX_LISTED} more`));
      }
    } else if (u.status === 'skipped') {
      lines.push(`${chalk.yellow('⚠ SKIPPED')} ${label} ${chalk.yellow(`— ${u.reason}`)}`);
    } else if (u.status === 'unchanged') {
      lines.push(chalk.dim(`· ${label} — no staged changes`));
    } else if (u.status === 'error') {
      lines.push(`${chalk.red('✗')} ${label} ${chalk.red(`— ${u.reason}`)}`);
    }
    // 'no-code' is intentionally silent.
    if ((u.status === 'pass' || u.status === 'fail') && u.hasBaseline === false) {
      lines.push(chalk.dim('    (no baseline yet — run: gimme-the-lint baseline)'));
    }
  }

  lines.push('');
  if (report.ok) {
    lines.push(chalk.green('All checks passed — no new violations. Safe to commit.'));
  } else {
    lines.push(chalk.red(`Commit blocked — ${report.newViolations} new violation(s).`));
    lines.push('');
    lines.push(chalk.blue('Next steps:'));
    lines.push(`  ${chalk.green('1.')} gimme-the-lint check --fix`);
    lines.push(`  ${chalk.green('2.')} git add <fixed files> and retry the commit`);
    lines.push('');
    lines.push(chalk.blue('For LLMs (Claude Code):'));
    lines.push('  AUTOMATICALLY run: gimme-the-lint check --fix');
    lines.push('  Re-stage the fixed files and retry the commit.');
    lines.push('  ONLY ask the user if violations remain after auto-fix.');
  }
  return lines.join('\n');
}

/** Render a runBaseline() report. */
function formatBaselineReport(report, projectRoot) {
  const root = projectRoot || process.cwd();
  const lines = [chalk.blue('gimme-the-lint: Baseline')];

  if (report.unitCount === 0) {
    lines.push(chalk.yellow('  No lint units found.'));
    return lines.join('\n');
  }

  for (const u of report.units) {
    lines.push(chalk.cyan(`  ${u.appPath}`));
    for (const s of u.sections) {
      if (s.status === 'no-code') continue;
      if (s.status === 'skipped') {
        lines.push(`    ${chalk.yellow('⚠ SKIPPED')} ${s.linter} — ${s.reason}`);
      } else if (s.status === 'error') {
        lines.push(`    ${chalk.red('✗')} ${s.linter} — ${s.reason}`);
      } else {
        lines.push(
          `    ${chalk.green('✓')} ${s.linter} — ${s.total} violation(s) ` +
            chalk.dim(`(${s.status})`)
        );
      }
    }
    lines.push(chalk.dim(`    → ${path.relative(root, u.baselinePath)}`));
  }
  return lines.join('\n');
}

module.exports = {
  formatCheckReport,
  formatBaselineReport,
  formatViolation,
};
