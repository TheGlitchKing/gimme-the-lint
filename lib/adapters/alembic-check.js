'use strict';

const fs = require('fs');
const path = require('path');
const { LinterAdapter, TIER, STAGE } = require('./adapter');
const { createViolation, SEVERITY } = require('../violation');

// Model ↔ migration drift: "you changed a model and forgot to generate a migration."
//
// The classic version of this bug is quiet and expensive. A developer adds a column
// to a SQLAlchemy model, the ORM happily reads and writes it in every test (the test
// database is created from the models), the PR is approved, and the deploy fails at
// 3am — or worse, does not fail, and the application starts writing to a column that
// does not exist in production.
//
// `alembic check` compares the models against the migration head and says whether a
// migration is missing. It is the single highest-value check in this file, and
// RE-InvestorHub has 68 revisions across THREE migration trees (migrations/,
// cache_migrations/, marketing_migrations/), entirely unguarded.
//
// TIER: EXTERNAL — and this is the whole reason the tier exists
//
// `alembic check` needs a database connection to autogenerate against. That breaks
// two invariants the engine holds on purpose:
//
//   * `check` is a git hook. It must stay hermetic and fast. A pre-commit hook that
//     dials a database is a pre-commit hook that fails on an aeroplane.
//   * `--offline` is a real, supported mode for air-gapped and regulated
//     environments. Nothing may silently require a network.
//
// So this adapter is EXTERNAL, which makes it STRUCTURALLY unreachable from `check`
// (see check.js) and reachable only from `verify`, which runs in CI where credentials
// legitimately live. That is not a convention anyone has to remember — no combination
// of flags can talk `check` into running it.

class AlembicCheckAdapter extends LinterAdapter {
  get id() {
    return 'alembic-check';
  }

  get languages() {
    return ['python'];
  }

  get supportsFix() {
    // `alembic revision --autogenerate` exists, but generating a migration is not a
    // lint fix — it is a schema change that a human must read before it ships. A tool
    // that silently authors migrations is a tool that will one day silently DROP a
    // column.
    return false;
  }

  get tier() {
    return TIER.EXTERNAL;
  }

  get stage() {
    return STAGE.CI;
  }

  get manifestFiles() {
    return ['alembic.ini'];
  }

  get sourceExtensions() {
    return ['.py'];
  }

  get binary() {
    return this.resolveBinary([
      path.join(this.appRoot, '.venv', 'bin', 'alembic'),
      path.join(this.projectRoot, '.venv', 'bin', 'alembic'),
      'alembic',
    ]);
  }

  configFiles() {
    return ['alembic.ini'];
  }

  versionArgs() {
    return ['--version'];
  }

  /**
   * Every alembic.ini under this app — a real project often has several, and each is
   * an independent migration tree with its own head. Checking only the first would
   * leave the others silently unguarded, which is the failure mode this whole engine
   * exists to eliminate.
   */
  migrationTrees(dir) {
    const root = dir || this.appRoot;
    const found = [];
    const walk = (absDir, depth) => {
      if (depth > 2) return;
      let entries;
      try {
        entries = fs.readdirSync(absDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isFile() && entry.name === 'alembic.ini') found.push(absDir);
        if (
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          entry.name !== 'node_modules'
        ) {
          walk(path.join(absDir, entry.name), depth + 1);
        }
      }
    };
    walk(root, 0);
    return found;
  }

  detect(dir) {
    return this.migrationTrees(dir).length > 0;
  }

  buildCommand(targets, opts = {}) {
    // One tree per invocation; lint() below iterates them.
    const cwd = opts.cwd || this._tree || this.appRoot;
    return { cmd: this.binary, args: ['check'], cwd };
  }

  /**
   * Did alembic fail because it could not REACH the database, rather than because the
   * migrations are wrong?
   *
   * The distinction decides between a SKIP and a FINDING, and getting it backwards is
   * expensive in both directions. Report a network blip as "your migrations are
   * broken" and people stop believing the check; report a genuinely missing migration
   * as "could not connect" and the deploy fails at 3am anyway.
   */
  static isConnectionFailure(output) {
    return /could not connect|connection refused|could not translate host|no such host|password authentication failed|does not exist|timeout expired|Connection timed out|OperationalError/i.test(
      String(output || '')
    );
  }

  /**
   * Run `alembic check` in every migration tree.
   *
   * Overridden rather than expressed through buildCommand() because a single app can
   * hold several independent trees, and the base class assumes one invocation.
   */
  lint(targets, opts = {}) {
    const trees = this.migrationTrees(this.appRoot);
    const violations = [];
    const { spawnSync } = require('child_process');

    for (const tree of trees) {
      const result = spawnSync(this.binary, ['check'], {
        cwd: tree,
        encoding: 'utf8',
        env: process.env, // credentials come from the environment, never from a config
        maxBuffer: 16 * 1024 * 1024,
      });

      if (result.error) {
        const err = new Error(`alembic-check: could not run alembic — ${result.error.message}`);
        err.code = 'ADAPTER_SKIPPED';
        throw err;
      }

      const output = `${result.stdout || ''}${result.stderr || ''}`;

      // Exit 0 means the models and the migration head agree.
      if (result.status === 0) continue;

      // Cannot reach the database. That is a SKIP, not a finding: we did not discover
      // that your migrations are wrong, we discovered that we could not look. Saying
      // otherwise would fail somebody's CI for a network blip and teach them to ignore
      // the check.
      if (AlembicCheckAdapter.isConnectionFailure(output)) {
        const err = new Error(
          `alembic-check: could not reach the database — ${output.trim().split('\n').slice(-1)[0]}`
        );
        err.code = 'ADAPTER_SKIPPED';
        throw err;
      }

      const rel = path.relative(this.projectRoot, tree) || '.';
      violations.push(
        createViolation({
          file: path.join(rel, 'alembic.ini'),
          ruleId: 'migration/model-not-migrated',
          severity: SEVERITY.ERROR,
          message:
            `The models in ${rel} do not match the migration head — a migration is ` +
            'missing. Your tests pass because the test database is built from the ' +
            'models; production is built from the migrations, and they now disagree. ' +
            'Run: alembic revision --autogenerate',
          source: 'alembic-check',
          // Identity is the TREE, not the message: alembic's wording of "new upgrade
          // operations detected" varies with what changed, and we do not want a
          // reworded diagnostic to read as a brand-new problem.
          fingerprintKey: `${rel}:model-not-migrated`,
          // Never baselineable. "We accept that our models and our production schema
          // disagree" is not a sentence anyone means. It is not debt; it is a deploy
          // that has not failed yet.
          neverBaseline: true,
        })
      );
    }

    return violations;
  }

  parse() {
    return []; // lint() is overridden; nothing reaches here
  }
}

module.exports = AlembicCheckAdapter;
