'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { LinterAdapter, TIER, STAGE } = require('../lib/adapters/adapter');
const adapters = require('../lib/adapters');
const { checkUnit } = require('../lib/check');
const { makeUnit } = require('../lib/units');

// TIER  — what an adapter NEEDS (local | reference | external).
// STAGE — WHEN it fires (commit | push | ci).
//
// Both are safety gates, not preferences, and both fail in a direction that is
// hard to notice: an `external` adapter that sneaks into `check` turns a git hook
// into something that needs a database, and a `push`-stage adapter that sneaks
// into a commit check makes every commit take seconds. Neither announces itself.

function tmpApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-tier-'));
  fs.writeFileSync(path.join(dir, 'code.xyz'), 'x');
  return dir;
}

/** A stub adapter that records whether it was ever actually executed. */
function stub({ id, tier, stage }) {
  return class Stub extends LinterAdapter {
    static ran = false;
    get id() {
      return id;
    }
    get tier() {
      return tier;
    }
    get stage() {
      return stage;
    }
    get sourceExtensions() {
      return ['.xyz'];
    }
    detect() {
      return true;
    }
    available() {
      return true;
    }
    lint() {
      Stub.ran = true;
      return [];
    }
  };
}

test.describe('defaults: every pre-existing adapter is unchanged', () => {
  // The seven adapters that existed before the contract engine. Named explicitly
  // rather than derived from the registry, because the whole point is to detect a
  // change to THESE — a list computed from the registry would silently absorb one.
  const PRE_EXISTING = [
    'eslint',
    'biome',
    'ruff',
    'golangci-lint',
    'clippy',
    'tflint',
    'ansible-lint',
  ];

  test('all 7 pre-existing adapters are still local-tier, commit-stage', () => {
    // The release rests on this: an existing user must feel nothing. If one of these
    // silently acquired a non-default tier or stage, it would either stop running on
    // commit (a check that vanishes) or start demanding a network (an air-gapped
    // install that breaks). Both are silent.
    for (const id of PRE_EXISTING) {
      const a = adapters.getAdapter(id, { projectRoot: '/tmp', appRoot: '/tmp' });
      assert.strictEqual(a.tier, TIER.LOCAL, `${id} must still be local tier`);
      assert.strictEqual(a.stage, STAGE.COMMIT, `${id} must still be commit stage`);
    }
  });

  test('a new adapter that opts out of the defaults is doing so DELIBERATELY', () => {
    // `contract` is the first adapter to leave the defaults. This test exists so
    // that the next one to do so cannot happen by accident: if an adapter appears
    // here, someone chose it, and this list is where they say so.
    const nonDefault = adapters
      .listAdapters()
      .map((id) => adapters.getAdapter(id, { projectRoot: '/tmp', appRoot: '/tmp' }))
      .filter((a) => a.tier !== TIER.LOCAL || a.stage !== STAGE.COMMIT)
      .map((a) => `${a.id}:${a.tier}/${a.stage}`);

    assert.deepStrictEqual(nonDefault, [
      'contract:local/push',
      'openapi:local/push',
      'alembic-check:external/ci',
    ]);
  });
});

test.describe('tier: external can never run inside check', () => {
  test('an external adapter is refused, and never executed', async () => {
    const dir = tmpApp();
    const Ext = stub({ id: 'needs-db', tier: TIER.EXTERNAL, stage: STAGE.COMMIT });
    const unit = makeUnit(dir, '.', ['needs-db']);

    const result = await checkUnit(dir, unit, new Ext({ projectRoot: dir, appRoot: dir }), {});

    assert.strictEqual(result.status, 'ci-only');
    assert.match(result.reason, /verify/, 'must point the user at the command that CAN run it');
    assert.strictEqual(Ext.ran, false, 'an external adapter must not execute during check');
  });

  test('it is refused even when explicitly asked for by stage', async () => {
    const dir = tmpApp();
    const Ext = stub({ id: 'needs-db', tier: TIER.EXTERNAL, stage: STAGE.COMMIT });
    const unit = makeUnit(dir, '.', ['needs-db']);

    // No flag combination may talk check into running an external adapter. The
    // gate is structural — a config cannot loosen it.
    for (const opts of [{ stage: 'push' }, { stage: 'commit' }, { all: true, strict: true }]) {
      const r = await checkUnit(dir, unit, new Ext({ projectRoot: dir, appRoot: dir }), opts);
      assert.strictEqual(r.status, 'ci-only');
    }
    assert.strictEqual(Ext.ran, false);
  });
});

test.describe('stage: the commit hook stays fast', () => {
  test('a push-stage adapter does NOT run at --stage=commit', async () => {
    const dir = tmpApp();
    const Slow = stub({ id: 'slow', tier: TIER.LOCAL, stage: STAGE.PUSH });
    const unit = makeUnit(dir, '.', ['slow']);

    const result = await checkUnit(
      dir,
      unit,
      new Slow({ projectRoot: dir, appRoot: dir }),
      { stage: 'commit' }
    );

    assert.strictEqual(result.status, 'other-stage');
    assert.strictEqual(Slow.ran, false, 'the expensive adapter must not have been executed');
  });

  test('a push-stage adapter does NOT run with NO stage flag at all', async () => {
    // THE upgrade-regression guard. A user who upgrades still has their OLD git
    // hooks, which call `check` with no --stage. If the default were "run
    // everything", those stale hooks would start importing the whole app on every
    // commit — a multi-second pre-commit hook nobody asked for, arriving as a
    // surprise. Defaulting to `commit` makes a stale hook do LESS, never more.
    const dir = tmpApp();
    const Slow = stub({ id: 'slow', tier: TIER.LOCAL, stage: STAGE.PUSH });
    const unit = makeUnit(dir, '.', ['slow']);

    const result = await checkUnit(dir, unit, new Slow({ projectRoot: dir, appRoot: dir }), {});

    assert.strictEqual(result.status, 'other-stage');
    assert.strictEqual(Slow.ran, false);
  });

  test('an unrecognized stage string falls back to commit, not to everything', async () => {
    const dir = tmpApp();
    const Slow = stub({ id: 'slow', tier: TIER.LOCAL, stage: STAGE.PUSH });
    const unit = makeUnit(dir, '.', ['slow']);

    const result = await checkUnit(
      dir,
      unit,
      new Slow({ projectRoot: dir, appRoot: dir }),
      { stage: 'nonsense' }
    );

    // Garbage in must not mean "run the expensive thing".
    assert.strictEqual(result.status, 'other-stage');
    assert.strictEqual(Slow.ran, false);
  });
});

test.describe('stage: push is cumulative', () => {
  test('--stage=push runs push-stage adapters', async () => {
    const dir = tmpApp();
    const Slow = stub({ id: 'slow', tier: TIER.LOCAL, stage: STAGE.PUSH });
    const unit = makeUnit(dir, '.', ['slow']);

    const result = await checkUnit(
      dir,
      unit,
      new Slow({ projectRoot: dir, appRoot: dir }),
      { stage: 'push' }
    );

    assert.strictEqual(result.status, 'pass');
    assert.strictEqual(Slow.ran, true);
  });

  test('--stage=push ALSO runs commit-stage adapters', async () => {
    // A push must never be a weaker check than the commits it contains.
    const dir = tmpApp();
    const Fast = stub({ id: 'fast', tier: TIER.LOCAL, stage: STAGE.COMMIT });
    const unit = makeUnit(dir, '.', ['fast']);

    const result = await checkUnit(
      dir,
      unit,
      new Fast({ projectRoot: dir, appRoot: dir }),
      { stage: 'push' }
    );

    assert.strictEqual(result.status, 'pass');
    assert.strictEqual(Fast.ran, true);
  });
});
