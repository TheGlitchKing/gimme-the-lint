'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const adapters = require('../lib/adapters');
const { LinterAdapter } = require('../lib/adapters/adapter');
const { runCheck } = require('../lib/check');
const { formatCheckReport } = require('../lib/report');
const { createViolation } = require('../lib/violation');
const baselineStore = require('../lib/baseline-store');

// ISSUE #26 — A STALE BASELINE ENTRY AND A FILE NOBODY OPENED LOOK IDENTICAL.
//
// `diff()` reports every baselined fingerprint missing from the current results as
// `fixed`. That is right for a run that looked at everything and nonsense for one
// that did not: on a staged commit a per-file linter is handed two files, so the
// rest of the baseline is "missing" only because nobody opened it.
//
// Measured before the fix: 100 baselined violations, ONE file staged, nothing
// actually fixed — 99 reported as stale. Two consequences, both bad:
//
//   - every commit printed a warning that was false, and a warning that is always
//     wrong is one people learn to skip past;
//   - `--no-stale-baseline` failed any commit that did not stage the whole repo,
//     which made the flag useless on the hook it exists for.
//
// The baseline stores {fingerprint: count} with no filename, so a scoped run cannot
// narrow `fixed` to the files it did read — the hashes are opaque. A partial run is
// therefore excluded whole, and asking to FAIL on staleness in a run that cannot
// detect it has to be loud, or the ratchet silently stops ratcheting.

// A linter that honours its targets — every real linter except the type checkers.
class PerFileStub extends LinterAdapter {
  get id() {
    return 'perfile-stub';
  }
  get sourceExtensions() {
    return ['.x'];
  }
  detect() {
    return true;
  }
  available() {
    return true;
  }
  version() {
    return '1.0.0';
  }
  lint(targets) {
    const list = targets && targets.length ? targets : [];
    const wholeApp = list.some((t) => t === '.' || t === '');
    // Only reports on files it was actually handed.
    const visible = wholeApp
      ? ALL_VIOLATIONS
      : ALL_VIOLATIONS.filter((v) => list.includes(v.file));
    // ...minus the ones a developer has genuinely repaired. Those SHOULD read as
    // stale baseline entries — but only to a run that looked at their files.
    return visible.filter((v) => !repaired.has(v.file));
  }
}

// A whole-program linter: ignores targets, always reports everything.
class WholeProgramStub extends PerFileStub {
  get id() {
    return 'wholeprogram-stub';
  }
  get wholeProgram() {
    return true;
  }
  lint() {
    // Ignores targets entirely — the defining behavior.
    return ALL_VIOLATIONS.filter((v) => !repaired.has(v.file));
  }
}

// Files whose violation a developer has actually repaired. Set per test; a stale
// baseline entry is exactly what one of these should produce — to a run that looked.
const repaired = new Set();

const ALL_VIOLATIONS = [];
for (let i = 0; i < 100; i++) {
  const file = `f${String(i).padStart(3, '0')}.x`;
  ALL_VIOLATIONS.push(
    createViolation({ file, ruleId: 'R1', message: 'known', fingerprintKey: `${file}:R1` })
  );
}

adapters.registerAdapter('perfile-stub', PerFileStub);
adapters.registerAdapter('wholeprogram-stub', WholeProgramStub);

/** A repo with all 100 violations baselined and exactly ONE file staged. */
function project(linterId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-stale26-'));
  execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir });
  for (const v of ALL_VIOLATIONS) fs.writeFileSync(path.join(dir, v.file), 'x\n');
  fs.mkdirSync(path.join(dir, '.gtl'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.gtl', 'config.js'),
    `module.exports = { apps: { '.': { linters: ['${linterId}'] } } };\n`
  );
  execSync('git add -A && git commit -qm init', { cwd: dir });

  const section = baselineStore.createLinterSection(ALL_VIOLATIONS, {
    toolVersion: '1.0.0',
    configHash: 'h',
  });
  const baseline = baselineStore.setLinterSection(
    baselineStore.emptyBaseline(),
    linterId,
    section
  );
  fs.mkdirSync(path.join(dir, '.gtl', 'apps', 'root'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.gtl', 'apps', 'root', 'baseline.json'),
    JSON.stringify(baseline, null, 2)
  );

  // Touch and stage exactly one file. Nothing is fixed.
  fs.writeFileSync(path.join(dir, 'f000.x'), 'y\n');
  execSync('git add f000.x', { cwd: dir });
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  repaired.clear();
}

// ---------------------------------------------------------------------------------
test.describe('a scoped run does not invent stale baseline entries', () => {
  test('per-file linter, one file staged, nothing fixed → ZERO stale', async () => {
    // The regression itself. Before the fix this was 99.
    const dir = project('perfile-stub');
    try {
      const report = await runCheck(dir, { changedOnly: true, stage: 'commit' });
      assert.strictEqual(report.staleEntries, 0, 'a file nobody opened is not a fixed violation');
      assert.strictEqual(report.staleUnevaluated, true, 'and the engine knows it declined');
    } finally {
      cleanup(dir);
    }
  });

  test('the false warning is gone from the output', async () => {
    const dir = project('perfile-stub');
    try {
      const out = formatCheckReport(await runCheck(dir, { changedOnly: true, stage: 'commit' }));
      assert.doesNotMatch(out, /no longer occur/);
    } finally {
      cleanup(dir);
    }
  });

  test('--no-stale-baseline no longer fails a commit that staged one file', async () => {
    // This is what made the flag unusable on a pre-commit hook.
    const dir = project('perfile-stub');
    try {
      const report = await runCheck(dir, {
        changedOnly: true,
        stage: 'commit',
        noStaleBaseline: true,
      });
      assert.strictEqual(report.ok, true);
    } finally {
      cleanup(dir);
    }
  });

  test('...but it says so, loudly — a silent pass would be worse than the bug', async () => {
    // The flag is a ratchet. One that quietly does nothing is worse than none at
    // all, because somebody is relying on it.
    const dir = project('perfile-stub');
    try {
      const out = formatCheckReport(
        await runCheck(dir, { changedOnly: true, stage: 'commit', noStaleBaseline: true })
      );
      assert.match(out, /--no-stale-baseline did NOT run/);
      assert.match(out, /--all/);
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------------
test.describe('a run that DID look at everything still ratchets', () => {
  test('--all: genuinely stale entries are still counted', async () => {
    const dir = project('perfile-stub');
    try {
      // One violation genuinely repaired. A run that looked at every file must
      // still notice that the baseline is now one entry too generous.
      repaired.add('f042.x');
      const report = await runCheck(dir, { changedOnly: false, stage: 'commit' });
      assert.strictEqual(report.staleEntries, 1, 'a complete run must still detect slack');
      assert.strictEqual(report.staleUnevaluated, false);
    } finally {
      cleanup(dir);
    }
  });

  test('--all --no-stale-baseline still FAILS on stale entries', async () => {
    // The feature must survive its own bug fix.
    const dir = project('perfile-stub');
    try {
      repaired.add('f042.x');
      const report = await runCheck(dir, {
        changedOnly: false,
        stage: 'commit',
        noStaleBaseline: true,
      });
      assert.strictEqual(report.ok, false, 'the ratchet must survive its own bug fix');
    } finally {
      cleanup(dir);
    }
  });

  test('a whole-program adapter is trusted even on a scoped run', async () => {
    // tsc/mypy ignore targets and check everything regardless, so their `fixed` is
    // honest whether or not the run was scoped. Excluding them would throw away the
    // one case that always works.
    const dir = project('wholeprogram-stub');
    try {
      const report = await runCheck(dir, { changedOnly: true, stage: 'commit' });
      assert.strictEqual(report.staleUnevaluated, false, 'it saw everything, so it counts');
      assert.strictEqual(report.staleEntries, 0, 'and nothing was actually fixed');
    } finally {
      cleanup(dir);
    }
  });
});
