'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const adapters = require('../lib/adapters');
const { TIER, STAGE } = require('../lib/adapters/adapter');
const projectModel = require('../lib/project-model');

// MIGRATION SAFETY — a different question from migration syntax.
//
//   ALTER TABLE deals ADD COLUMN notes text NOT NULL DEFAULT '';
//
// Nothing is malformed. It runs in 3ms on a laptop, in CI, and in staging with its
// four hundred rows. In production it takes an ACCESS EXCLUSIVE lock on forty million
// rows and pins every read and write behind it until it finishes.
//
// The deploy "succeeds". The site is down. A linter that checks syntax has nothing
// whatsoever to say about this, which is why it needs its own adapter.

function migrationRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-squawk-'));
  fs.mkdirSync(path.join(dir, 'migrations'));
  fs.writeFileSync(
    path.join(dir, 'migrations', '001_add_notes.sql'),
    "ALTER TABLE deals ADD COLUMN notes text NOT NULL DEFAULT '';\n"
  );
  return dir;
}

function adapter(root) {
  return adapters.getAdapter('squawk', { projectRoot: root, appRoot: root });
}

test.describe('registration', () => {
  test('it is local-tier and runs on COMMIT', () => {
    // A migration is exactly the thing you want to be told about while you are still
    // writing it — not three days later, standing in front of a deploy.
    const a = adapter('/tmp');
    assert.strictEqual(a.tier, TIER.LOCAL);
    assert.strictEqual(a.stage, STAGE.COMMIT);
  });

  test('there is no autofix, and there should not be', () => {
    // The remedy for "this takes an exclusive lock" is to rewrite the migration as a
    // safe multi-step dance: add the column nullable, backfill in batches, add the
    // constraint NOT VALID, validate it separately. That is a change of PLAN, not a
    // change of text. A tool that "fixed" it automatically would be rewriting your
    // deploy strategy without asking.
    assert.strictEqual(adapter('/tmp').supportsFix, false);
  });
});

test.describe('it only looks at migrations', () => {
  test('a migration file is found', () => {
    const dir = migrationRepo();
    const files = adapter(dir)._migrationFiles(dir);
    assert.strictEqual(files.length, 1);
    assert.match(files[0], /001_add_notes\.sql$/);
  });

  test('a seed file, an analytics query and a fixture are IGNORED', () => {
    // squawk's rules are about danger at scale against a live table. That is a
    // meaningful question for a migration and a meaningless one for a seed file. Run
    // it on everything with a .sql extension and the real findings drown — and noise
    // is what teaches people to stop reading a linter.
    const dir = migrationRepo();
    fs.writeFileSync(path.join(dir, 'seed.sql'), 'INSERT INTO deals VALUES (1);\n');
    fs.mkdirSync(path.join(dir, 'analytics'));
    fs.writeFileSync(path.join(dir, 'analytics', 'report.sql'), 'SELECT 1;\n');

    const files = adapter(dir)._migrationFiles(dir);

    assert.strictEqual(files.length, 1, 'only the migration');
    assert.match(files[0], /migrations/);
  });

  test('a repo with no migrations detects nothing at all', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-nosql-'));
    fs.writeFileSync(path.join(dir, 'seed.sql'), 'SELECT 1;\n');
    assert.strictEqual(adapter(dir).detect(dir), false);
  });
});

test.describe('parse', () => {
  test('a locking ALTER becomes a violation', () => {
    const dir = migrationRepo();
    const out = JSON.stringify([
      {
        file: path.join(dir, 'migrations', '001_add_notes.sql'),
        line: 1,
        column: 0,
        level: 'Warning',
        rule_name: 'adding-not-nullable-field',
        messages: [
          {
            Note: 'Adding a NOT NULL field requires a table rewrite and an ACCESS EXCLUSIVE lock.',
          },
          { Help: 'Add the column as nullable, backfill, then add the constraint.' },
        ],
      },
    ]);

    const a = adapter(dir);
    a._runCwd = dir;
    const violations = a.parse(out);

    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].ruleId, 'squawk/adding-not-nullable-field');
    assert.match(violations[0].message, /ACCESS EXCLUSIVE/);
    assert.match(violations[0].message, /backfill/, 'it must say what to do instead');
  });

  test('identity includes the file — a migration is an immutable historical record', () => {
    // Unlike a schema, a migration is never moved or refactored: it is a fact about a
    // moment. So the file belongs in its identity. And if someone writes a NEW
    // migration containing the same hazard, that genuinely IS a new problem and must
    // not be suppressed by the old one's baseline.
    const dir = migrationRepo();
    const a = adapter(dir);
    a._runCwd = dir;

    const mk = (file) =>
      a.parse(
        JSON.stringify([
          { file: path.join(dir, 'migrations', file), line: 1, level: 'Warning', rule_name: 'r' },
        ])
      )[0];

    assert.notStrictEqual(
      mk('001_add_notes.sql').fingerprintKey,
      mk('002_add_status.sql').fingerprintKey
    );
  });

  test('a dangerous migration IS baselineable', () => {
    // It has already shipped. The lock it takes is in the past, and the table it
    // locked has long since been unlocked. Blocking every future commit over a
    // migration that ran last March would be absurd — and it is exactly the debt
    // progressive linting exists to grandfather.
    const dir = migrationRepo();
    const a = adapter(dir);
    a._runCwd = dir;
    const v = a.parse(
      JSON.stringify([
        { file: path.join(dir, 'migrations', '001_add_notes.sql'), line: 1, level: 'Warning', rule_name: 'r' },
      ])
    )[0];

    assert.strictEqual(v.neverBaseline, false);
  });

  test('empty or unparseable output yields nothing rather than exploding', () => {
    const a = adapter('/tmp');
    assert.deepStrictEqual(a.parse(''), []);
    assert.deepStrictEqual(a.parse('not json'), []);
  });
});

test.describe('discovery', () => {
  test('a migrations/ directory binds squawk — in ANY language', () => {
    // A Django repo, a Rails repo and a bare supabase/migrations directory all ship
    // the same ALTER statements and all take the same locks. The hazard is in the SQL,
    // not in the framework that emitted it.
    const dir = migrationRepo();
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module x\n'); // not even a Python repo

    const apps = projectModel.discoverApps(dir);

    assert.ok(apps[0].linters.includes('squawk'));
  });

  test('a repo with no migrations directory does not bind it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-nomig-'));
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module x\n');

    const apps = projectModel.discoverApps(dir);

    assert.ok(!apps[0].linters.includes('squawk'));
  });
});
