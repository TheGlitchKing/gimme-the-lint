'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const { runCheck } = require('../lib/check');
const { runBaseline } = require('../lib/baseline');
const adapters = require('../lib/adapters');
const { LinterAdapter, TIER, STAGE } = require('../lib/adapters/adapter');
const { createViolation } = require('../lib/violation');
const { fingerprint } = require('../lib/fingerprint');
const baselineStore = require('../lib/baseline-store');
const diffEngine = require('../lib/diff-engine');

// THE INVARIANTS.
//
// Everything else in this suite tests that a feature WORKS. This file tests that the
// things which must never happen, never happen — and each promise made anywhere in
// this release has exactly one test here that goes red when it is broken.
//
// Every one of these was verified by deliberately breaking the implementation and
// watching the assertion fail. A promise with no failing test behind it is a comment.
//
// They share a shape: each guards against a SILENT failure. Not a crash — a crash is
// honest — but a check that quietly stops checking while continuing to report
// success. That is the disease this entire engine exists to cure, so it must not be
// how the engine itself fails.

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-inv-'));
  execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[project]\nname="x"\n');
  fs.writeFileSync(path.join(dir, 'app.py'), 'x = 1\n');
  return dir;
}

/** Every file in a tree, with its bytes. For proving nothing was touched. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

// ---------------------------------------------------------------------------------
test.describe('INVARIANT: `check` never mutates the working tree', () => {
  // A pre-commit hook that edits your files behind your back is a hostile pre-commit
  // hook. You would be committing something you never read.
  test('the tree is byte-identical after check, in every mode', async () => {
    const dir = tmpProject();
    const before = snapshot(dir);

    for (const opts of [
      {},
      { all: true },
      { stage: 'push' },
      { stage: 'push', all: true },
      { fix: true }, // even --fix: no adapter is installed here, so nothing may change
    ]) {
      await runCheck(dir, opts);
      assert.deepStrictEqual(snapshot(dir), before, `check(${JSON.stringify(opts)}) mutated the tree`);
    }
  });

  test('check never writes a baseline', async () => {
    // If `check` could write a baseline it would grandfather the very violation that
    // just blocked you — the guard would silently disarm itself the first time it
    // fired.
    const dir = tmpProject();

    await runCheck(dir, { all: true, stage: 'push' });

    assert.strictEqual(
      fs.existsSync(path.join(dir, '.gtl')),
      false,
      'check must not create .gtl/'
    );
  });
});

// ---------------------------------------------------------------------------------
test.describe('INVARIANT: a defect can never be grandfathered', () => {
  // The one place this tool stops being progressive, and therefore the rule people
  // will most want to work around. Three independent gates; each test attacks one.
  const defect = () =>
    createViolation({
      ruleId: 'contract/reserved-metadata-unaliased',
      message: '500 on every read',
      fingerprintKey: 'Conversation.metadata:reserved',
      neverBaseline: true,
    });

  test('GATE 1 — `baseline` will not capture it, however often you run it', () => {
    assert.deepStrictEqual(baselineStore.buildFingerprintMap([defect(), defect()]), {});
  });

  test('GATE 2 — a hand-planted fingerprint in the baseline file does not suppress it', () => {
    // Gate 1 means a baseline WE wrote cannot contain one, so the way around it is to
    // put it there yourself: open the JSON, paste the hash, make the noise stop.
    // Trusting the file would make the guarantee only as strong as the least careful
    // edit anyone ever made to it.
    const planted = { [fingerprint(defect())]: 999 };
    assert.strictEqual(diffEngine.diff([defect()], planted).new.length, 1);
  });

  test('GATE 3 — `baseline` says what it refused, so nobody is ambushed later', () => {
    const refused = baselineStore.unbaselineable([defect()]);
    assert.strictEqual(refused.length, 1);
  });

  test('and ordinary debt is STILL fully baselineable', () => {
    // All of the above is worthless if it broke normal progressive linting. A tool
    // that blocks on pre-existing debt is a tool nobody installs — and an uninstalled
    // tool catches no defects at all.
    const debt = createViolation({ file: 'a.py', ruleId: 'x', message: 'm' });
    const baseline = baselineStore.buildFingerprintMap([debt]);
    assert.strictEqual(diffEngine.diff([debt], baseline).new.length, 0);
  });
});

// ---------------------------------------------------------------------------------
test.describe('INVARIANT: an external check can never reach a git hook', () => {
  // `check` is a hook. It must be hermetic: a hook that dials a database fails on an
  // aeroplane, hangs behind a VPN, and is uninstalled within the week.
  test('no flag combination talks `check` into running one', async () => {
    const dir = tmpProject();
    fs.writeFileSync(path.join(dir, 'alembic.ini'), '[alembic]\n');

    for (const opts of [{}, { all: true }, { stage: 'commit' }, { stage: 'push' }, { stage: 'ci' }]) {
      const report = await runCheck(dir, opts);
      const ext = report.units.find((u) => u.linter === 'alembic-check');
      assert.strictEqual(ext.status, 'ci-only', `flags ${JSON.stringify(opts)} let an external check run`);
    }
  });
});

// ---------------------------------------------------------------------------------
test.describe('INVARIANT: a check that could not run NEVER reports a pass', () => {
  // The disease this whole engine exists to cure, in its purest form. "We found
  // nothing" and "we could not look" are the same number of violations and opposite
  // facts. Collapse them and the guard reports green while guarding nothing.
  function skipper() {
    return new (class extends LinterAdapter {
      get id() {
        return 'skipper';
      }
      get sourceExtensions() {
        return ['.py'];
      }
      detect() {
        return true;
      }
      available() {
        return true;
      }
      lint() {
        const err = new Error('could not import the application');
        err.code = 'ADAPTER_SKIPPED';
        throw err;
      }
    })({ projectRoot: '/tmp', appRoot: '/tmp' });
  }

  test('an ADAPTER_SKIPPED is reported as SKIPPED, never as pass', async () => {
    const { checkUnit } = require('../lib/check');
    const { makeUnit } = require('../lib/units');
    const dir = tmpProject();

    const result = await checkUnit(dir, makeUnit(dir, '.', ['skipper']), skipper(), {});

    assert.strictEqual(result.status, 'skipped');
    assert.notStrictEqual(result.status, 'pass');
    assert.match(result.reason, /could not import/, 'and it must say WHY');
  });

  test('a missing linter never blocks the commit', async () => {
    // The idempotent-skip contract. A repo without gtl-contract installed must be able
    // to commit — otherwise installing this tool would be a breaking change for
    // everyone who has not finished setting it up.
    const dir = tmpProject();
    const report = await runCheck(dir, { all: true, stage: 'push' });
    assert.strictEqual(report.ok, true, 'a missing linter must not block');
  });
});

// ---------------------------------------------------------------------------------
test.describe('INVARIANT: we never write a file we did not generate', () => {
  test('an authored spec survives every command untouched', () => {
    // Regenerating over a hand-authored spec destroys human work, silently, on a
    // routine command. Provenance is a MARKER, never an inference: getting it wrong in
    // one direction leaves a stale guard, and in the other it eats somebody's file.
    const dir = tmpProject();
    const spec = path.join(dir, 'openapi.json');
    const authored = JSON.stringify({ openapi: '3.1.0', info: { title: 'Mine' } }, null, 2);
    fs.writeFileSync(spec, authored);

    const a = adapters.getAdapter('openapi', { projectRoot: dir, appRoot: dir });
    const result = a.materialize();

    assert.ok(result.skipped);
    assert.strictEqual(fs.readFileSync(spec, 'utf8'), authored);
  });

  test('the seven pre-existing adapters derive nothing at all', () => {
    // materialize() is opt-in, like initCommand(). No adapter may acquire a filesystem
    // side effect by inheritance.
    for (const id of ['eslint', 'ruff', 'biome', 'clippy', 'tflint', 'golangci-lint', 'ansible-lint']) {
      assert.strictEqual(
        adapters.getAdapter(id, { projectRoot: '/tmp', appRoot: '/tmp' }).materialize(),
        null
      );
    }
  });
});

// ---------------------------------------------------------------------------------
test.describe('INVARIANT: existing users feel nothing', () => {
  // The load-bearing promise of the whole release. Every change is additive; prove it.
  test('the 7 pre-existing adapters keep their tier and stage', () => {
    for (const id of ['eslint', 'biome', 'ruff', 'golangci-lint', 'clippy', 'tflint', 'ansible-lint']) {
      const a = adapters.getAdapter(id, { projectRoot: '/tmp', appRoot: '/tmp' });
      assert.strictEqual(a.tier, TIER.LOCAL);
      assert.strictEqual(a.stage, STAGE.COMMIT);
    }
  });

  test('a violation with no fingerprintKey hashes EXACTLY as it did in v2.5.2', () => {
    // The catastrophic case. Every baseline in every repo is a map keyed by these
    // hashes. Shift the scheme by one byte and every baselined violation on earth
    // reads as new the moment its owner upgrades — and the tool blocks every commit in
    // the repo it was installed to unblock.
    //
    // Asserted against a digest computed by v2.5.2 and pasted in as a literal. A test
    // that recomputes its own expectation cannot fail; it can only agree with itself.
    assert.strictEqual(
      fingerprint({
        file: 'src/a.js',
        ruleId: 'no-unused-vars',
        message: "'x' is assigned a value but never used.",
      }),
      '86eadaa25c3c6d7c5f788f9e8039e876b0e734d0'
    );
  });

  test('a repo with no Python at all is completely unaffected', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-go-'));
    execSync('git init -q', { cwd: dir });
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module x\n');
    fs.writeFileSync(path.join(dir, 'main.go'), 'package main\n');

    const report = await runCheck(dir, { all: true, stage: 'push' });

    const ids = report.units.map((u) => u.linter);
    assert.deepStrictEqual(ids, ['golangci-lint'], 'no contract check, no openapi, nothing new');
  });
});

// ---------------------------------------------------------------------------------
test.describe('INVARIANT: a stale hook degrades to inert, never to slow', () => {
  test('a bare `check` (what an OLD hook calls) runs no push-stage adapter', async () => {
    // Hooks are installed FILES; upgrading the package cannot rewrite one a user
    // installed months ago. Those stale hooks call `check` with no --stage. Had the
    // default been "run everything", they would silently have begun importing the whole
    // app on every commit — a multi-second pre-commit hook arriving as an upgrade
    // regression, and a slow hook is a hook people disable.
    //
    // Fail toward inert ("the new check does not fire yet" — loud, detectable, fixed by
    // `gimme-the-lint hooks`), never toward annoying ("your commits got slow" — silent,
    // and fixed by uninstalling).
    const dir = tmpProject();

    const report = await runCheck(dir, {}); // no --stage: exactly what a v2.5.2 hook does

    const contract = report.units.find((u) => u.linter === 'contract');
    assert.strictEqual(contract.status, 'other-stage', 'it must NOT have run');
  });
});
