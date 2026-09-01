'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { UNCHECKED_STATUSES } = require('../lib/check');
const { toJson } = require('../lib/json-report');
const { formatCheckReport } = require('../lib/report');

// #19. `⚠ SKIPPED backend · contract` correctly means UNVERIFIED — and it does not fail
// the run, so in a CI log the warning scrolls past and the job goes green. The contract
// was never checked and the PR shows a green tick.
//
// That is the same "guard that reports green" this project exists to eliminate, arriving
// through omission rather than through a stale hook. It is easy to land in by accident:
// an explicit `apps` map bypasses auto-discovery, and the contract check imports the app,
// so a typical `lint` job has neither the Python deps nor the import-time env it needs.
// Both produce a skip. Neither is visible on a green build.

function report(units, overrides = {}) {
  return {
    ok: true,
    newViolations: 0,
    staleEntries: 0,
    staleUnevaluated: false,
    stage: 'push',
    unitCount: units.length,
    units,
    unchecked: units
      .filter((u) => UNCHECKED_STATUSES.has(u.status))
      .map((u) => ({ unit: u.unit, linter: u.linter, status: u.status, reason: u.reason || null })),
    legacyDetected: false,
    failOnSkip: false,
    ...overrides,
  };
}

const SKIPPED = { unit: 'backend', linter: 'contract', status: 'skipped', reason: 'gtl-contract not importable' };
const CLEAN = { unit: 'backend', linter: 'eslint', status: 'pass', diff: { new: [], summary: {} } };

test.describe('the summary stops claiming coverage it does not have', () => {
  test('"All checks passed" is not printed when a check did not run', () => {
    const out = formatCheckReport(report([SKIPPED]));

    assert.ok(
      !out.includes('All checks passed'),
      'it is not "all checks" if one of them never ran'
    );
    assert.match(out, /DID NOT RUN/);
  });

  test('the per-unit line says NOT CHECKED, and what that means', () => {
    // The reporter's own suggested wording. The reader who most needs this line is the
    // one skimming a CI log, so it has to survive being skimmed.
    const out = formatCheckReport(report([SKIPPED]));

    assert.match(out, /SKIPPED \(NOT CHECKED\)/);
    assert.match(out, /This is not a pass\. Nothing was verified\./);
    assert.match(out, /gtl-contract not importable/);
  });

  test('a genuinely clean run still gets its green line', () => {
    // A warning printed on a clean run is a warning people learn to ignore.
    const out = formatCheckReport(report([CLEAN]));

    assert.match(out, /All checks passed/);
    assert.ok(!out.includes('DID NOT RUN'));
  });

  test('it names the flag that would make this fail', () => {
    const out = formatCheckReport(report([SKIPPED]));

    assert.match(out, /--fail-on-skip/);
  });
});

test.describe('--fail-on-skip blocks, and says why it blocked', () => {
  test('a run blocked by a skip does not report "0 new violation(s)"', () => {
    // Otherwise the report reads as a bug in the tool rather than the ratchet working.
    const out = formatCheckReport(
      report([SKIPPED], { ok: false, failOnSkip: true })
    );

    assert.match(out, /DID NOT RUN \(--fail-on-skip\)/);
    assert.ok(!/— 0 new violation/.test(out));
    assert.match(out, /A skip is not a pass/);
  });

  test('a real finding still reports as a finding, not as a skip', () => {
    const failing = {
      unit: 'backend',
      linter: 'eslint',
      status: 'fail',
      diff: { new: [{ ruleId: 'x/y', file: 'a.js', line: 1, message: 'bad' }] },
    };
    const out = formatCheckReport(
      report([failing], { ok: false, failOnSkip: true, newViolations: 1 })
    );

    assert.match(out, /1 new violation/);
  });
});

test.describe('an ERROR is a skip too — the half the issue did not mention', () => {
  // An errored unit returns early with no `diff`, so it contributes 0 to newViolations
  // and the run goes green. Same bug, different status.
  test('error counts as unchecked', () => {
    assert.ok(UNCHECKED_STATUSES.has('error'));

    const out = formatCheckReport(
      report([{ unit: 'backend', linter: 'ruff', status: 'error', reason: 'venv exploded' }])
    );

    assert.match(out, /DID NOT RUN/);
  });

  test('needs-baseline counts as unchecked — it diffed against nothing', () => {
    assert.ok(UNCHECKED_STATUSES.has('needs-baseline'));
  });

  test('the engine and the JSON report agree on what "unchecked" means', () => {
    // Two definitions of this would eventually disagree, and the half that drifted
    // would report a blind run as a clean one.
    const { UNCHECKED } = require('../lib/json-report');
    assert.strictEqual(UNCHECKED, UNCHECKED_STATUSES);
  });
});

test.describe('the JSON carries the same verdict', () => {
  test('ok goes false under --fail-on-skip, and allChecked was already false', () => {
    const out = toJson(report([SKIPPED], { ok: false, failOnSkip: true }));

    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.allChecked, false);
    assert.strictEqual(out.skipped.length, 1);
  });
});

test.describe('end to end: the flag actually changes the exit code', () => {
  // The tests above assert on the RENDERING. They pass a hand-built report in, so they
  // never exercise the engine's `ok` decision — and when this suite was first written
  // they all stayed green while `--fail-on-skip` was stubbed out to do nothing.
  //
  // The whole ask of #19 is that the run FAILS. That is an exit code, so it gets tested
  // as one, against a real repo with a real missing linter.
  const { execFileSync } = require('child_process');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { execSync } = require('child_process');

  const CLI = path.join(__dirname, '..', 'bin', 'gimme-the-lint.js');

  function repoWithAMissingLinter() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-skip-'));
    execSync('git init -q', { cwd: dir });
    // A Go module with no golangci-lint on PATH: present code, absent linter → skip.
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module x\n\ngo 1.21\n');
    fs.writeFileSync(path.join(dir, 'main.go'), 'package main\n\nfunc main() {}\n');
    return dir;
  }

  function run(dir, args) {
    try {
      const stdout = execFileSync(process.execPath, [CLI, ...args], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, stdout };
    } catch (e) {
      return { code: e.status, stdout: e.stdout || '' };
    }
  }

  test('without the flag a skip warns and the run passes', () => {
    const dir = repoWithAMissingLinter();
    const { code, stdout } = run(dir, ['check', '--all']);

    assert.strictEqual(code, 0, 'unchanged default: a skip must not start blocking on upgrade');
    assert.match(stdout, /NOT CHECKED/);
  });

  test('with the flag the same run FAILS', () => {
    const dir = repoWithAMissingLinter();
    const { code, stdout } = run(dir, ['check', '--all', '--fail-on-skip']);

    assert.strictEqual(code, 1, 'this is the entire point of the issue');
    assert.match(stdout, /DID NOT RUN/);
  });

  test('and the JSON says so too', () => {
    const dir = repoWithAMissingLinter();
    const { code, stdout } = run(dir, ['check', '--all', '--fail-on-skip', '--json']);
    const payload = JSON.parse(stdout);

    assert.strictEqual(code, 1);
    assert.strictEqual(payload.ok, false);
    assert.strictEqual(payload.allChecked, false);
    assert.ok(payload.skipped.length > 0);
  });

  test('a repo with nothing to skip still passes under the flag', () => {
    // A ratchet that can never be satisfied is a ratchet people remove.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-noskip-'));
    execSync('git init -q', { cwd: dir });

    const { code } = run(dir, ['check', '--all', '--fail-on-skip']);

    assert.strictEqual(code, 0);
  });
});
