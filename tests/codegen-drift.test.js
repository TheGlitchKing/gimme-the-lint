'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const adapters = require('../lib/adapters');
const { TIER, STAGE } = require('../lib/adapters/adapter');
const baselineStore = require('../lib/baseline-store');
const diffEngine = require('../lib/diff-engine');
const { fingerprint } = require('../lib/fingerprint');
const projectModel = require('../lib/project-model');

// THE LAST UNGUARDED RUNG.
//
// Drift lives wherever two artifacts must AGREE. It cannot exist where one is DERIVED.
// Every other rung of the chain — Postgres ⇕ models ⇕ schemas ⇕ lockfile — is now
// guarded. Then the truth leaves Python and is handed to a human to retype.
//
// What that costs, from the wild:
//
//   A component read `prospect.zip`. The API returns `zip_code`. Backend correct,
//   contract check green, lockfile fresh, database row right — and the user saw a blank
//   ZIP field for a full release cycle, because `undefined` renders as nothing, and
//   nothing looks exactly like data that was never saved.
//
// With generated types that is a compile error before it is anything else.

const GENERATOR = path.join(__dirname, '..', 'node_modules', '.bin', 'openapi-typescript');
const HAVE_GENERATOR = fs.existsSync(GENERATOR);

function repo({ zipField = 'zip_code', codegen = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-codegen-'));
  execSync('git init -q', { cwd: dir });

  fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[project]\nname="x"\n');
  fs.writeFileSync(path.join(dir, 'app.py'), 'x = 1\n');

  // The generator lives in the PROJECT'S node_modules — which is exactly where the
  // adapter looks for it, and exactly where a real user's would be.
  //
  // The first version of this fixture omitted this, and the tests passed anyway — but
  // only under `npm run`, because npm silently puts ./node_modules/.bin on PATH. Run them
  // with a bare `node --test` and every one of them failed with ENOENT. They were green
  // for a reason that had nothing to do with the code under test, which is the most
  // dangerous kind of green there is.
  const bin = path.join(dir, 'node_modules', '.bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.symlinkSync(fs.realpathSync(GENERATOR), path.join(bin, 'openapi-typescript'));

  // The lockfile: what the API actually serves.
  fs.writeFileSync(
    path.join(dir, 'openapi.json'),
    JSON.stringify(
      {
        openapi: '3.1.0',
        info: { title: 't', version: '1' },
        'x-generated-by': 'gimme-the-lint',
        paths: {
          '/prospects/{id}': {
            get: {
              operationId: 'get_prospect',
              responses: {
                200: {
                  description: 'ok',
                  content: {
                    'application/json': { schema: { $ref: '#/components/schemas/Prospect' } },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            Prospect: {
              type: 'object',
              properties: { id: { type: 'string' }, [zipField]: { type: 'string' } },
              required: ['id'],
            },
          },
        },
      },
      null,
      2
    ) + '\n'
  );

  fs.mkdirSync(path.join(dir, 'frontend', 'src'), { recursive: true });

  const cfg = {
    apps: { '.': { linters: ['codegen-drift'] } },
    contract: {
      app: 'app.main:app',
      lockfile: 'openapi.json',
      ...(codegen
        ? { codegen: [{ generator: 'openapi-typescript', output: 'frontend/src/api-types.ts' }] }
        : {}),
    },
  };
  fs.mkdirSync(path.join(dir, '.gtl'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.gtl', 'config.js'),
    `module.exports = ${JSON.stringify(cfg, null, 2)};\n`
  );

  return dir;
}

function adapter(dir) {
  return adapters.getAdapter('codegen-drift', { projectRoot: dir, appRoot: dir });
}

/** Write the types the way `materialize` would. */
function generateInto(dir) {
  const result = adapter(dir).materialize();
  fs.mkdirSync(path.dirname(result.path), { recursive: true });
  fs.writeFileSync(result.path, result.content);
  return result.path;
}

test.describe('the adapter contract', () => {
  test('local tier, COMMIT stage — it never imports the app', () => {
    // Unlike `contract` and `openapi`, this reads a committed JSON file and runs a JS
    // generator over it: milliseconds. So it can afford to run on every commit, and the
    // feedback is immediate — regenerate the lockfile, and the very next commit tells you
    // the frontend is behind.
    const a = adapter('/tmp');
    assert.strictEqual(a.tier, TIER.LOCAL);
    assert.strictEqual(a.stage, STAGE.COMMIT);
  });

  test('no autofix — a hook that rewrites your types commits code you never read', () => {
    assert.strictEqual(adapter('/tmp').supportsFix, false);
  });

  test('it binds ONLY when a generator and an output path are configured', () => {
    // Three explicit signals, all required. A lockfile alone is not consent; a JS app
    // alone is not consent. A repo that types its frontend by hand has usually chosen
    // that, and a linter that nags people about deliberate choices gets uninstalled.
    const withCodegen = repo({ codegen: true });
    const without = repo({ codegen: false });

    assert.strictEqual(adapter(withCodegen).detect(withCodegen), true);
    assert.strictEqual(adapter(without).detect(without), false);
  });

  test('a repo with no codegen config never sees this adapter at all', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-nocodegen-'));
    fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[project]\nname="x"\n');

    const apps = projectModel.discoverApps(dir);

    assert.ok(!apps[0].linters.includes('codegen-drift'));
  });
});

test.describe('materialize runs in DERIVATION order, not alphabetical', () => {
  test('openapi comes before codegen-drift', () => {
    // The single most dangerous ordering bug available here, and it is invisible.
    //
    // A unit's `linters` array is SORTED. Alphabetically, `codegen-drift` < `openapi`.
    // Run them that way and `materialize` generates the client types from YESTERDAY'S
    // lockfile, then overwrites the lockfile — so the types are stale the instant they
    // are written, and the command whose entire job is to make them fresh is the thing
    // that staled them. It would report success.
    const ordered = adapters.materializeOrder(['codegen-drift', 'contract', 'openapi']);

    assert.ok(
      ordered.indexOf('openapi') < ordered.indexOf('codegen-drift'),
      'the lockfile must be written before anything is derived from it'
    );
  });

  test('alphabetical order would get it WRONG (this is why the helper exists)', () => {
    const naive = ['codegen-drift', 'contract', 'openapi'].sort();
    assert.ok(
      naive.indexOf('codegen-drift') < naive.indexOf('openapi'),
      'sanity: alphabetical really does put codegen first'
    );
  });
});

test.describe('codegen-stale is a DEFECT — it can never be grandfathered', () => {
  const stale = () =>
    require('../lib/violation').createViolation({
      file: 'frontend/src/api-types.ts',
      ruleId: 'contract/codegen-stale',
      message: 'no longer matches openapi.json',
      fingerprintKey: 'frontend/src/api-types.ts:codegen-stale',
      neverBaseline: true,
    });

  test('baseline will not capture it', () => {
    // A stale generated type is not a GAP. It is a lie the compiler is currently
    // believing. Grandfathering it means writing down "we accept that our frontend is
    // typed against an API we do not serve."
    assert.deepStrictEqual(baselineStore.buildFingerprintMap([stale()]), {});
  });

  test('a hand-planted hash in the baseline does not suppress it', () => {
    const planted = { [fingerprint(stale())]: 1 };
    assert.strictEqual(diffEngine.diff([stale()], planted).new.length, 1);
  });

  test('but codegen-MISSING is debt — you have to be able to adopt this', () => {
    // Every repo starts without generated types. If "you have none" could not be
    // grandfathered, nobody could install the check without first generating them — and a
    // linter you must repair your repo to install is a linter nobody installs.
    const missing = require('../lib/violation').createViolation({
      ruleId: 'contract/codegen-missing',
      fingerprintKey: 'frontend/src/api-types.ts:codegen-missing',
    });
    assert.ok(baselineStore.buildFingerprintMap([missing])[fingerprint(missing)]);
  });
});

test.describe('normalize: whitespace noise is not a contract change', () => {
  const { normalize } = require('../lib/adapters/codegen-drift');

  test('CRLF, trailing spaces and a missing final newline all compare equal', () => {
    // A Windows checkout, an editor that strips trailing newlines, a .gitattributes that
    // normalizes line endings — any of these would otherwise report codegen-stale on a
    // file that is semantically identical. A guard that cries wolf on clean code gets
    // switched off, taking its real findings with it.
    const a = 'export interface Prospect {\n  zip_code?: string;\n}\n';
    const b = 'export interface Prospect {\r\n  zip_code?: string;   \r\n}';

    assert.strictEqual(normalize(a), normalize(b));
  });

  test('but a REAL difference still differs', () => {
    assert.notStrictEqual(
      normalize('zip_code?: string;'),
      normalize('zip?: string;'),
      'the entire point'
    );
  });
});

// The tests below shell out to the real generator.
test.describe('against the real generator', { skip: !HAVE_GENERATOR }, () => {
  test('generated types matching the lockfile are CLEAN', () => {
    const dir = repo();
    generateInto(dir);

    assert.deepStrictEqual(adapter(dir).lint(), []);
  });

  test('THE ACCEPTANCE TEST — the bug from the wild', () => {
    // `prospect.zip` vs `zip_code`. The backend was right, the contract check was green,
    // the lockfile was fresh, the database row was correct — and the user saw a blank
    // field for a full release cycle.
    //
    // Prove the guard can go RED before proving it goes green. A contract test that
    // cannot fail is decoration.
    const dir = repo({ zipField: 'zip_code' });
    generateInto(dir); // types now say zip_code — everything agrees

    assert.deepStrictEqual(adapter(dir).lint(), [], 'green before the change');

    // Now the API renames the field, and the lockfile is regenerated — but nobody
    // regenerates the client types. This is exactly what happened.
    const lock = path.join(dir, 'openapi.json');
    fs.writeFileSync(lock, fs.readFileSync(lock, 'utf8').replace(/zip_code/g, 'zip'));

    const violations = adapter(dir).lint();

    assert.strictEqual(violations.length, 1, 'the guard must go RED');
    assert.strictEqual(violations[0].ruleId, 'contract/codegen-stale');
    assert.strictEqual(violations[0].neverBaseline, true, 'and it must not be baselineable');
    assert.match(violations[0].message, /materialize/, 'and it must say how to fix it');

    // And regenerating makes it green again — a rule that cannot be satisfied is a rule
    // people disable.
    generateInto(dir);
    assert.deepStrictEqual(adapter(dir).lint(), [], 'green after regenerating');
  });

  test('a missing output file is reported as codegen-missing', () => {
    const dir = repo();

    const violations = adapter(dir).lint();

    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].ruleId, 'contract/codegen-missing');
    assert.strictEqual(violations[0].neverBaseline, false, 'debt — it must be baselineable');
  });

  test('a HAND-WRITTEN types file is reported and NEVER overwritten', () => {
    // The case that decides whether anyone can adopt this. Every codebase that needs this
    // check is, by definition, one that currently hand-maintains its types. A materialize
    // that silently ate forms.ts would be the last thing anyone ever ran.
    const dir = repo();
    const out = path.join(dir, 'frontend', 'src', 'api-types.ts');
    const authored = 'export interface Prospect {\n  zip?: string;  // WRONG, and mine\n}\n';
    fs.writeFileSync(out, authored);

    const violations = adapter(dir).lint();

    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].ruleId, 'contract/codegen-stale');
    assert.match(violations[0].message, /hand-written/);

    // AND it must be un-baselineable, on THIS path too.
    //
    // Mutation testing found this gap: the acceptance test only exercises the *generated*
    // branch, so flipping `neverBaseline` on the hand-written branch went completely
    // unnoticed. The two paths produce the same rule and must carry the same weight — and
    // this is the branch where it matters MOST, because a hand-written file that disagrees
    // with the API is the exact case somebody would most like to baseline away.
    assert.strictEqual(
      violations[0].neverBaseline,
      true,
      'a hand-written file that lies about the API is still a defect'
    );

    // materialize must REFUSE...
    const result = adapter(dir).materialize();
    assert.ok(result.skipped, 'it must refuse to generate over a human file');
    assert.strictEqual(result.content, undefined);

    // ...and the file must be byte-for-byte untouched.
    assert.strictEqual(fs.readFileSync(out, 'utf8'), authored);
  });

  test('the generator version feeds tool_version, so a bump is DRIFT not a violation', () => {
    // If a generator bump reordered a union and that read as `codegen-stale`, the check
    // would fail every repo's CI on an unrelated Tuesday — and the first thing any team
    // does then is disable it. Determinism is not cosmetic; it is what makes the guard
    // survivable.
    //
    // We need no new machinery: version() already feeds tool_version into the baseline,
    // and drift.js already reports type: 'version' when it moves.
    const dir = repo();
    const v = adapter(dir).version();

    assert.match(v, /^\d+\.\d+\.\d+$/, 'it must report the GENERATOR version, not ours');
  });

  test('the generator is byte-deterministic (or this check is unusable)', () => {
    const dir = repo();
    const a = adapter(dir).materialize().content;
    const b = adapter(dir).materialize().content;

    assert.strictEqual(a, b);
  });
});

test.describe('a generator that is not installed never blocks a commit', () => {
  test('available() is false, so checkUnit skips before lint() is ever reached', async () => {
    // The idempotent-skip contract, which is what lets this ship at all. A repo that has
    // not installed openapi-typescript must still be able to commit — otherwise adding
    // this adapter would be a breaking change for everyone who has not finished setting
    // it up.
    const { checkUnit } = require('../lib/check');
    const { makeUnit } = require('../lib/units');

    const dir = repo();

    // Point the adapter at a binary that certainly does not exist.
    //
    // Deleting the fixture's node_modules is NOT enough, and finding that out was
    // instructive: `npm run` puts ./node_modules/.bin on PATH, so the generator remains
    // resolvable via PATH and `available()` keeps returning true. The test passed alone
    // and failed in the suite. The environment was answering a question I thought I was
    // asking of the code — twice now, in opposite directions, in this one file.
    const a = adapter(dir);
    Object.defineProperty(a, 'binary', {
      get: () => path.join(dir, 'node_modules', '.bin', 'definitely-not-installed'),
    });

    const result = await checkUnit(dir, makeUnit(dir, '.', ['codegen-drift']), a, {
      stage: 'commit',
    });

    assert.strictEqual(result.status, 'skipped');
    assert.notStrictEqual(result.status, 'fail', 'a missing generator must never block');
  });
});
