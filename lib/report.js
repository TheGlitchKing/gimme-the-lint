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
    } else if (u.status === 'needs-baseline') {
      lines.push(
        `${chalk.yellow('⚠ NEEDS BASELINE')} ${label} ${chalk.yellow(`— ${u.reason}`)}`
      );
    } else if (u.status === 'ci-only') {
      lines.push(`${chalk.dim('· ' + label)} ${chalk.dim(`— ${u.reason}`)}`);
    }
    // 'no-code' and 'other-stage' are intentionally silent.
    if ((u.status === 'pass' || u.status === 'fail') && u.hasBaseline === false) {
      lines.push(chalk.dim('    (no baseline yet — run: gimme-the-lint baseline)'));
    }
  }

  // A baseline entry that no longer occurs. Informational: the baseline has more
  // slack in it than the code needs, and should be refreshed so it cannot quietly
  // re-admit the violation later.
  if (report.staleEntries > 0) {
    lines.push('');
    lines.push(
      chalk.yellow(
        `⚠ ${report.staleEntries} baseline entr(ies) no longer occur — the baseline ` +
          'has stale slack in it.'
      )
    );
    lines.push(chalk.dim('  Refresh with: gimme-the-lint baseline'));
  }

  const verb = report.stage === 'push' ? 'Push' : 'Commit';

  lines.push('');
  if (report.ok) {
    lines.push(
      chalk.green(`All checks passed — no new violations. Safe to ${verb.toLowerCase()}.`)
    );
    return lines.join('\n');
  }

  lines.push(chalk.red(`${verb} blocked — ${report.newViolations} new violation(s).`));

  // Is ANY of what blocked us actually auto-fixable? If not, telling the reader to
  // run `--fix` sends them in a circle — and the next lever they reach for is
  // `baseline`, which would grandfather the finding instead of fixing it. For an
  // LLM that loop is worse than useless: it ends with a real bug silently accepted
  // and a cheerful report of success. So the guidance below is derived from the
  // adapters that actually failed, never assumed.
  const failed = report.units.filter((u) => u.status === 'fail');
  const anyFixable = failed.some((u) => u.supportsFix);

  lines.push('');
  lines.push(chalk.blue('Next steps:'));
  if (anyFixable) {
    lines.push(`  ${chalk.green('1.')} gimme-the-lint check --fix`);
    lines.push(`  ${chalk.green('2.')} git add <fixed files> and retry`);
    lines.push('');
    lines.push(chalk.blue('For LLMs (Claude Code):'));
    lines.push('  AUTOMATICALLY run: gimme-the-lint check --fix');
    lines.push('  Re-stage the fixed files and retry.');
    lines.push('  ONLY ask the user if violations remain after auto-fix.');
  } else {
    const names = [...new Set(failed.map((u) => u.linter))].join(', ');
    lines.push(`  ${chalk.green('1.')} Fix the violation(s) above — ${names} has no autofix.`);
    lines.push(
      `  ${chalk.green('2.')} If a violation is deliberate, declare it in .gtl/config.js with a reason.`
    );
    lines.push('');
    lines.push(chalk.blue('For LLMs (Claude Code):'));
    lines.push(chalk.red('  Do NOT run --fix — there is no autofix for these rules.'));
    lines.push(
      chalk.red('  Do NOT run `gimme-the-lint baseline` to clear this — that grandfathers')
    );
    lines.push(chalk.red('  a real defect instead of fixing it.'));
    lines.push('  These are correctness findings. Fix them, or show them to the user.');
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
      if (s.status === 'unavailable') {
        lines.push(
          `    ${chalk.red('⚠ UNAVAILABLE')} ${s.linter} — ${s.reason} ` +
            chalk.red('(NOT baselined)')
        );
      } else if (s.status === 'error') {
        lines.push(
          `    ${chalk.red('✗ ERROR')} ${s.linter} — ${s.reason} ` +
            chalk.red('(NOT baselined)')
        );
      } else if (s.status === 'skipped') {
        lines.push(`    ${chalk.yellow('⚠ SKIPPED')} ${s.linter} — ${s.reason}`);
      } else {
        lines.push(
          `    ${chalk.green('✓')} ${s.linter} — ${s.total} violation(s) ` +
            chalk.dim(`(${s.status})`)
        );
      }
    }
    lines.push(chalk.dim(`    → ${path.relative(root, u.baselinePath)}`));
  }

  // Prominent incomplete summary — a baseline missing linters must never look
  // like a success.
  if (report.incomplete && report.incomplete.length) {
    lines.push('');
    lines.push(
      chalk.red(`✗ ${report.incomplete.length} linter(s) were NOT baselined:`)
    );
    for (const i of report.incomplete) {
      lines.push(chalk.red(`    ${i.app} · ${i.linter} (${i.status})`));
    }
    lines.push(
      chalk.yellow(
        '  This baseline is INCOMPLETE. Install the missing linters and re-run'
      )
    );
    lines.push(
      chalk.yellow(
        '  `gimme-the-lint baseline` before relying on it to gate commits.'
      )
    );
  }
  return lines.join('\n');
}

module.exports = {
  formatCheckReport,
  formatBaselineReport,
  formatViolation,
};
