'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const adapters = require('../lib/adapters');
const { STAGE, TIER } = require('../lib/adapters/adapter');
const { fingerprint } = require('../lib/fingerprint');
const baselineStore = require('../lib/baseline-store');
const diffEngine = require('../lib/diff-engine');

// THE API CONTRACT LOCKFILE
//
// FastAPI computes an OpenAPI document from your schemas and serves it at
// /openapi.json. It is complete, correct, and invisible to every tool that reads
// files — so nothing stops a field rename from silently breaking every client of an
// endpoint. There is no artifact to diff, so there is no diff, so there is no
// warning.
//
// Writing it down turns a 4am page into a line in a pull request.

function adapter(root) {
  return adapters.getAdapter('openapi', { projectRoot: root, appRoot: root });
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-openapi-'));
}

test.describe('registration', () => {
  test('it is a separate adapter from `contract`', () => {
    // Two entries over ONE binary, deliberately. They answer different questions and
    // must baseline independently: a team may carry model/schema debt for a quarter
    // while accepting ZERO drift between their API and its published contract.
    assert.ok(adapters.hasAdapter('openapi'));
    assert.ok(adapters.hasAdapter('contract'));
    assert.notStrictEqual(adapters.getAdapter('openapi').id, adapters.getAdapter('contract').id);
  });

  test('it runs on push, and needs no network', () => {
    const a = adapter('/tmp');
    assert.strictEqual(a.stage, STAGE.PUSH);
    assert.strictEqual(a.tier, TIER.LOCAL);
  });

  test('it has no autofix — `materialize` is a deliberate command, not a hook side-effect', () => {
    assert.strictEqual(adapter('/tmp').supportsFix, false);
  });
});

test.describe('the file-class rule: a lockfile is COMPILED, not authored', () => {
  test('a stale lockfile can never be baselined', () => {
    // THE inert-guard case. Baselining "your lockfile is out of date" would switch
    // the guard off permanently while leaving it looking green — which is precisely
    // the failure the lockfile exists to prevent. It would be a guard guarding
    // nothing, reporting success.
    // NOTE the explicit `neverBaseline`. The JS side used to INFER it ("everything except
    // lockfile-missing is a defect"), which worked for exactly as long as there were two
    // rules — and silently mis-classified the next two the moment they were added. The
    // provider now declares it, and this stub must reproduce the REAL wire, verified
    // against gtl-contract's actual output. A stub that omits a field the real thing
    // sends is a test of a program that does not exist.
    const stale = adapter('/tmp').parse(
      JSON.stringify({
        checked: true,
        violations: [
          {
            file: '/tmp/openapi.json',
            ruleId: 'contract/lockfile-stale',
            message: 'no longer matches the code',
            fingerprintKey: 'openapi:lockfile-stale',
            neverBaseline: true,
          },
        ],
      }),
      '',
      0
    )[0];

    assert.strictEqual(stale.neverBaseline, true);

    // And prove it end to end through the engine: capture refuses it, and the diff
    // engine still blocks even if someone plants the hash by hand.
    assert.deepStrictEqual(baselineStore.buildFingerprintMap([stale]), {});

    const planted = { [fingerprint(stale)]: 1 };
    assert.strictEqual(diffEngine.diff([stale], planted).new.length, 1);
  });

  test('a MISSING lockfile is debt — you have to be able to adopt this', () => {
    // Every FastAPI project on earth starts without one. If "you have no lockfile"
    // could not be grandfathered, nobody could install the tool without first
    // materializing — and a linter you must fix your repo to install is a linter
    // nobody installs.
    const missing = adapter('/tmp').parse(
      JSON.stringify({
        checked: true,
        violations: [
          {
            file: 'openapi.json',
            ruleId: 'contract/lockfile-missing',
            message: 'no lockfile',
            fingerprintKey: 'openapi:lockfile-missing',
          },
        ],
      }),
      '',
      0
    )[0];

    assert.strictEqual(missing.neverBaseline, false);
    assert.ok(baselineStore.buildFingerprintMap([missing])[fingerprint(missing)]);
  });

  test('a spec/implementation mismatch can never be baselined', () => {
    // A published contract that has quietly stopped describing the implementation is
    // worse than no contract: clients are generated from it and agreements are made
    // on it, and all of it is now fiction.
    const mismatch = adapter('/tmp').parse(
      JSON.stringify({
        checked: true,
        violations: [
          {
            file: '/tmp/openapi.yaml',
            ruleId: 'contract/spec-implementation-mismatch',
            message: 'drifted',
            fingerprintKey: 'openapi:spec-implementation-mismatch',
            neverBaseline: true,
          },
        ],
      }),
      '',
      0
    )[0];

    assert.strictEqual(mismatch.neverBaseline, true);
  });
});

test.describe('the engine does not get a vote on what is a defect', () => {
  test('neverBaseline comes from the PROVIDER, never from a rule-id guess', () => {
    // The bug this exists to prevent, which I shipped and then caught:
    //
    // openapi.js used to infer the flag by EXCLUSION — `ruleId !== 'lockfile-missing'`.
    // That is correct for exactly as long as there are two rules. The moment
    // `route-without-response-model` and `unstable-operation-id` were added, both were
    // silently promoted to DEFECTS — and route-without-response-model fires 48 times on a
    // real codebase. Adopting the tool would have meant fixing 48 routes before your next
    // commit. Nobody does that. They uninstall.
    //
    // Rules belong to the linter that defines them.
    const a = adapter('/tmp');

    const mk = (ruleId, neverBaseline) =>
      a.parse(
        JSON.stringify({
          checked: true,
          violations: [{ file: 'x', ruleId, message: 'm', fingerprintKey: 'k', neverBaseline }],
        }),
        '',
        0
      )[0];

    // An unknown rule id the engine has never heard of, declared as debt, stays debt.
    assert.strictEqual(mk('openapi/some-future-rule', false).neverBaseline, false);
    // And the same unknown id, declared a defect, is a defect.
    assert.strictEqual(mk('openapi/some-future-rule', true).neverBaseline, true);
    // An omitted flag is debt — the safe default. Silently promoting something to
    // un-baselineable is how you block a push over a rule nobody agreed to.
    assert.strictEqual(mk('contract/lockfile-stale', undefined).neverBaseline, false);
  });
});

test.describe('provenance: a file we did not write is sacred', () => {
  test('materialize REFUSES to overwrite a hand-authored spec', () => {
    // The catastrophic case, and the reason provenance is a marker rather than an
    // inference. In a schema-first project the spec IS the source of truth and the
    // code is generated from it. Regenerating over it destroys human work — silently,
    // on a routine command.
    //
    // Both failures (stale lockfile / destroyed spec) are reachable from the same
    // wrong assumption in opposite directions, so we never guess. No marker means
    // authored, and authored is untouchable.
    const root = tmp();
    const lockfile = path.join(root, 'openapi.json');
    const authored = JSON.stringify(
      { openapi: '3.1.0', info: { title: 'Written by a person' } },
      null,
      2
    );
    fs.writeFileSync(lockfile, authored);

    const result = adapter(root).materialize();

    assert.ok(result.skipped, 'it must refuse');
    assert.match(result.skipped, /hand-authored/);
    assert.strictEqual(
      fs.readFileSync(lockfile, 'utf8'),
      authored,
      'the file must be byte-for-byte unchanged'
    );
    assert.strictEqual(result.content, undefined, 'and it must not even offer content');
  });

  test('a file WE generated carries the marker and may be regenerated', () => {
    const root = tmp();
    const lockfile = path.join(root, 'openapi.json');
    fs.writeFileSync(
      lockfile,
      JSON.stringify({ openapi: '3.1.0', 'x-generated-by': 'gimme-the-lint' })
    );

    // No `skipped` — it is ours, so regenerating is allowed. (It will fail to spawn
    // gtl-contract in this bare tmpdir; the point is that it TRIED rather than
    // refusing on provenance grounds.)
    assert.throws(() => adapter(root).materialize(), /could not derive|ENOENT|not/);
  });

  test('an unparseable existing file is treated as ours, not as sacred', () => {
    // A corrupt lockfile is not a hand-authored spec; it is a corrupt lockfile.
    // Refusing to fix it would strand the user with a file only `materialize` can
    // repair and a `materialize` that will not touch it.
    const root = tmp();
    fs.writeFileSync(path.join(root, 'openapi.json'), 'not json at all {{{');
    assert.throws(() => adapter(root).materialize(), /could not derive|ENOENT|not/);
  });
});

test.describe('materialize is the ONLY writer', () => {
  test('the base adapter derives nothing — every ordinary linter is unaffected', () => {
    // materialize() is an opt-in hook, exactly like initCommand(). Seven adapters
    // shipped before this one and none of them should acquire a filesystem side
    // effect by inheritance.
    for (const id of ['eslint', 'ruff', 'biome', 'clippy', 'tflint', 'golangci-lint', 'ansible-lint']) {
      const a = adapters.getAdapter(id, { projectRoot: '/tmp', appRoot: '/tmp' });
      assert.strictEqual(a.materialize(), null, `${id} must not derive anything`);
    }
  });
});
