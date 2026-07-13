'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const adapters = require('../lib/adapters');
const { TIER, STAGE } = require('../lib/adapters/adapter');
const { runVerify } = require('../lib/verify');
const { runCheck } = require('../lib/check');
const projectModel = require('../lib/project-model');

// `verify` — the home for checks that need a database, a registry, or a network.
//
// It is a separate COMMAND, not a flag on `check`, because a flag can be passed by
// accident and an invariant that depends on nobody passing a flag is not an
// invariant.
//
// Two things the engine holds on purpose, and both would die if a database-touching
// check could reach a git hook:
//
//   * `check` is a pre-commit/pre-push hook. It must be hermetic. A hook that dials
//     a production database fails on an aeroplane, hangs behind a VPN, and gets
//     uninstalled inside a week.
//   * `--offline` is a real, supported mode for air-gapped environments.

function tmpApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-verify-'));
  fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[project]\nname="x"\n');
  fs.writeFileSync(path.join(dir, 'alembic.ini'), '[alembic]\nscript_location = migrations\n');
  fs.writeFileSync(path.join(dir, 'model.py'), 'x = 1\n');
  return dir;
}

test.describe('the alembic-check adapter', () => {
  test('it is EXTERNAL tier and CI stage', () => {
    const a = adapters.getAdapter('alembic-check', { projectRoot: '/tmp', appRoot: '/tmp' });
    assert.strictEqual(a.tier, TIER.EXTERNAL, 'it needs a live database');
    assert.strictEqual(a.stage, STAGE.CI, 'so it can never sit on a hook');
  });

  test('a missing migration can never be baselined', () => {
    // "We accept that our models and our production schema disagree" is not a
    // sentence anyone means. It is not debt; it is a deploy that has not failed yet.
    const { createViolation } = require('../lib/violation');
    const baselineStore = require('../lib/baseline-store');

    const v = createViolation({
      ruleId: 'migration/model-not-migrated',
      fingerprintKey: 'backend:model-not-migrated',
      neverBaseline: true,
    });

    assert.deepStrictEqual(baselineStore.buildFingerprintMap([v]), {});
  });

  test('it finds EVERY migration tree, not just the first', () => {
    // RE-InvestorHub has three (migrations/, cache_migrations/, marketing_migrations/).
    // Checking only the first would leave the others silently unguarded — which is
    // the exact failure this engine exists to eliminate.
    const dir = tmpApp();
    fs.mkdirSync(path.join(dir, 'cache_migrations'));
    fs.writeFileSync(path.join(dir, 'cache_migrations', 'alembic.ini'), '[alembic]\n');
    fs.mkdirSync(path.join(dir, 'marketing_migrations'));
    fs.writeFileSync(path.join(dir, 'marketing_migrations', 'alembic.ini'), '[alembic]\n');

    const a = adapters.getAdapter('alembic-check', { projectRoot: dir, appRoot: dir });

    assert.strictEqual(a.migrationTrees(dir).length, 3);
  });

  test('it has no autofix — a tool that silently authors migrations will one day silently DROP a column', () => {
    const a = adapters.getAdapter('alembic-check', { projectRoot: '/tmp', appRoot: '/tmp' });
    assert.strictEqual(a.supportsFix, false);
  });
});

test.describe('the separation is structural, not a convention', () => {
  test('`check` NEVER runs an external adapter, whatever the flags', async () => {
    const dir = tmpApp();

    // (`--strict` is deliberately not in this matrix: it throws on any uninstalled
    // linter, which is a different invariant with its own test, and it would mask the
    // one under examination here.)
    for (const opts of [{}, { stage: 'commit' }, { stage: 'push' }, { all: true }]) {
      const report = await runCheck(dir, opts);
      const alembic = report.units.find((u) => u.linter === 'alembic-check');
      assert.ok(alembic, 'it should be discovered...');
      assert.strictEqual(alembic.status, 'ci-only', '...but never actually run');
      assert.match(alembic.reason, /verify/, 'and it must say where it CAN be run');
    }
  });

  test('`verify` runs ONLY the external adapters', async () => {
    // The local ones already ran on commit and push. Running them again in `verify`
    // would make a red CI job ambiguous: did the contract break, or is this the lint
    // failure you already knew about?
    const dir = tmpApp();

    const report = await runVerify(dir, {});
    const ids = report.units.map((u) => u.linter);

    assert.ok(ids.includes('alembic-check'));
    assert.ok(!ids.includes('ruff'), 'ruff is local — it has no business here');
    assert.ok(!ids.includes('contract'), 'the contract check is local too');
  });
});

test.describe('offline fails CLOSED', () => {
  test('--offline makes verify throw rather than skip', async () => {
    // A silent skip would let a CI job go green having verified nothing at all — a
    // provisioning bug wearing the costume of a passing build. That is the exact
    // failure mode this whole engine exists to prevent, so it must not be how the
    // engine itself behaves.
    const dir = tmpApp();

    await assert.rejects(
      () => runVerify(dir, { offline: true }),
      (err) => {
        assert.strictEqual(err.code, 'OFFLINE_EXTERNAL');
        assert.match(err.message, /do not let it pass having checked nothing/);
        return true;
      }
    );
  });
});

test.describe('a database we cannot reach is a SKIP, not a finding', () => {
  const AlembicCheckAdapter = require('../lib/adapters/alembic-check');

  // The distinction decides between skipping and blocking, and it is expensive in
  // BOTH directions. Call a network blip "your migrations are broken" and people stop
  // believing the check; call a genuinely missing migration "could not connect" and
  // the deploy fails at 3am anyway.

  const CANNOT_REACH = [
    'sqlalchemy.exc.OperationalError: could not connect to server',
    'psycopg2.OperationalError: connection refused',
    'FATAL: password authentication failed for user "app"',
    'could not translate host name "db" to address',
    'Connection timed out',
  ];

  const GENUINELY_BROKEN = [
    'ERROR [alembic.util.messaging] Target database is not up to date.',
    'New upgrade operations detected: [add_column]',
    'Detected added column "deals.operating_expenses"',
  ];

  for (const output of CANNOT_REACH) {
    test(`SKIP: ${output.slice(0, 40)}…`, () => {
      assert.strictEqual(AlembicCheckAdapter.isConnectionFailure(output), true);
    });
  }

  for (const output of GENUINELY_BROKEN) {
    test(`FINDING: ${output.slice(0, 40)}…`, () => {
      assert.strictEqual(
        AlembicCheckAdapter.isConnectionFailure(output),
        false,
        'a real missing migration must NOT be excused as a connection problem'
      );
    });
  }
});

test.describe('discovery', () => {
  test('an alembic.ini binds the migration check', () => {
    const dir = tmpApp();
    const apps = projectModel.discoverApps(dir);
    assert.ok(apps[0].linters.includes('alembic-check'));
  });

  test('a Python app WITHOUT alembic gets no migration check', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-noalembic-'));
    fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[project]\nname="x"\n');

    const apps = projectModel.discoverApps(dir);

    assert.ok(!apps[0].linters.includes('alembic-check'));
  });
});
