'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const adapters = require('../lib/adapters');
const { TIER, STAGE } = require('../lib/adapters/adapter');
const { checkUnit } = require('../lib/check');
const { makeUnit } = require('../lib/units');
const projectModel = require('../lib/project-model');
const { fingerprint } = require('../lib/fingerprint');

// The Node half of the entity-contract check. The Python half (python/tests) proves
// the RULES are right; this proves the WIRING is right — that a skip is not a pass,
// that identity survives a file move, and that a defect arrives carrying the flag
// that stops it being grandfathered.

function adapter(opts = {}) {
  return adapters.getAdapter('contract', {
    projectRoot: opts.root || '/tmp',
    appRoot: opts.root || '/tmp',
  });
}

test.describe('registration and contract', () => {
  test('it is a registered adapter', () => {
    assert.ok(adapters.hasAdapter('contract'));
    assert.ok(adapters.listAdapters().includes('contract'));
  });

  test('it runs on push, not on commit', () => {
    // The whole reason for the `stage` axis. The checker imports the application
    // (seconds), which is fine once per push and intolerable on every commit. A
    // slow commit hook is a hook people disable, and a disabled hook guards nothing.
    assert.strictEqual(adapter().stage, STAGE.PUSH);
  });

  test('it is local-tier — it needs no network', () => {
    // It imports the app, but touches nothing outside the machine. So it is still
    // usable in an air-gapped install, and it is NOT confined to `verify`.
    assert.strictEqual(adapter().tier, TIER.LOCAL);
  });

  test('it declares that it has no autofix', () => {
    // Load-bearing: lib/report.js reads this to decide what to tell the user (and
    // an LLM) to do next. Claiming an autofix that does not exist sends the reader
    // in a circle, and the next lever they reach for is `baseline` — which
    // grandfathers the defect instead of repairing it.
    assert.strictEqual(adapter().supportsFix, false);
  });
});

test.describe('parse: violations', () => {
  test('a violation carries its fingerprintKey and neverBaseline flag', () => {
    const a = adapter();
    const out = JSON.stringify({
      checked: true,
      violations: [
        {
          file: 'app/schemas/deal.py',
          line: 0,
          ruleId: 'contract/column-not-writable',
          severity: 'error',
          message: 'No write schema accepts `operating_expenses`.',
          fingerprintKey: 'Deal.operating_expenses:writable',
        },
        {
          file: 'app/schemas/conversation.py',
          line: 0,
          ruleId: 'contract/reserved-metadata-unaliased',
          severity: 'error',
          message: '500 on every read.',
          fingerprintKey: 'Conversation.metadata:reserved',
          neverBaseline: true,
        },
      ],
    });

    const violations = a.parse(out, '', 0);

    assert.strictEqual(violations.length, 2);
    assert.strictEqual(violations[0].fingerprintKey, 'Deal.operating_expenses:writable');
    assert.strictEqual(violations[0].neverBaseline, false, 'debt must be baselineable');
    assert.strictEqual(violations[1].neverBaseline, true, 'a defect must carry the flag');
  });

  test('identity survives the schema file being moved', () => {
    const a = adapter();
    const mk = (file) =>
      a.parse(
        JSON.stringify({
          checked: true,
          violations: [
            {
              file,
              ruleId: 'contract/column-not-writable',
              message: 'no write schema accepts [operating_expenses]',
              fingerprintKey: 'Deal.operating_expenses:writable',
            },
          ],
        }),
        '',
        0
      )[0];

    // Reorganizing a package must not resurrect every finding it had grandfathered.
    assert.strictEqual(
      fingerprint(mk('app/schemas/deal.py')),
      fingerprint(mk('app/domain/deal/schemas.py'))
    );
  });

  test('a clean app parses to zero violations', () => {
    const violations = adapter().parse(JSON.stringify({ checked: true, violations: [] }), '', 0);
    assert.deepStrictEqual(violations, []);
  });
});

test.describe('parse: a skip is NOT a pass', () => {
  // The single most important behavior in this file. All three cases below produce
  // zero violations, and all three mean "we could not look". Reporting any of them
  // as clean would tell the user their contract is sound at the exact moment we
  // could not see it — a guard reporting green while guarding nothing.

  test('checked:false raises ADAPTER_SKIPPED, it does not return []', () => {
    const a = adapter();
    const out = JSON.stringify({
      checked: false,
      violations: [],
      skip: 'could not import the application models',
      detail: 'RuntimeError: DATABASE_URL is not set',
    });

    assert.throws(
      () => a.parse(out, '', 1),
      (err) => {
        assert.strictEqual(err.code, 'ADAPTER_SKIPPED');
        assert.match(err.message, /could not import/);
        // The cause has to reach the human. "Skipped" with no reason is unactionable.
        assert.match(err.message, /DATABASE_URL is not set/);
        return true;
      }
    );
  });

  test('empty output is an error, not an empty result', () => {
    assert.throws(() => adapter().parse('', '', 0), /produced no output/);
  });

  test('unparseable output is an error, not an empty result', () => {
    // An unparseable linter is a silently absent one.
    assert.throws(() => adapter().parse('Traceback (most recent call last)...', '', 1), /JSON/);
  });
});

test.describe('checkUnit maps a skip to SKIPPED, never to pass or fail', () => {
  function stubAdapter(behavior) {
    const a = adapter();
    a.detect = () => true;
    a.available = () => true;
    a.lint = behavior;
    return a;
  }

  test('an ADAPTER_SKIPPED error becomes status "skipped" and does not block', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-contract-'));
    const unit = makeUnit(dir, '.', ['contract']);

    const a = stubAdapter(() => {
      const err = new Error('no venv here');
      err.code = 'ADAPTER_SKIPPED';
      throw err;
    });

    const result = await checkUnit(dir, unit, a, { stage: 'push' });

    assert.strictEqual(result.status, 'skipped');
    assert.match(result.reason, /no venv here/);
    // Emphatically not 'pass': a skip means UNCHECKED.
    assert.notStrictEqual(result.status, 'pass');
  });

  test('a genuine crash is still an error, not a skip', async () => {
    // The distinction matters: "I could not look" is benign and expected. "I looked
    // and exploded" is a bug in us, and laundering it into a skip would hide it.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-contract-'));
    const unit = makeUnit(dir, '.', ['contract']);

    const a = stubAdapter(() => {
      throw new Error('segfault');
    });

    const result = await checkUnit(dir, unit, a, { stage: 'push' });

    assert.strictEqual(result.status, 'error');
  });
});

test.describe('discovery', () => {
  test('a Python app is bound to BOTH ruff and contract', () => {
    // They answer different questions and baseline independently: ruff asks "is this
    // code well-formed?", the contract asks "does the model agree with the schemas
    // exposing it?". Neither substitutes for the other.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-discover-'));
    fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[project]\nname="x"\n');

    const apps = projectModel.discoverApps(dir);

    assert.strictEqual(apps.length, 1);
    assert.deepStrictEqual(apps[0].linters.sort(), ['contract', 'ruff']);
  });

  test('a non-Python app gets no contract check', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-discover-'));
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module x\n');

    const apps = projectModel.discoverApps(dir);

    assert.deepStrictEqual(apps[0].linters, ['golangci-lint']);
  });
});

test.describe('the exit-code protocol stays the engine\'s business (#17)', () => {
  // `gtl-contract --exit-code` (2.9.0) makes the Python CLI return 3 when it checked
  // and found violations, for people wiring it into CI directly. The ENGINE must never
  // pass it: it reads `checked` and `violations` off the JSON payload, which carries
  // strictly more than a status byte can.
  //
  // The reason this is pinned rather than left to good sense: exit 1 means COULD NOT
  // CHECK, and parse() maps that onto ADAPTER_SKIPPED — a loud warning that never
  // blocks. Any future change that made "found violations" share a code with "could not
  // look" would report a findings run as a skip, which is a gate that stopped gating.
  test('the adapter never asks for --exit-code', () => {
    const adapter = adapters.getAdapter('contract', { projectRoot: '/tmp', appRoot: '/tmp' });
    const command = adapter.buildCommand([], {});
    const args = (command && (command.args || command)) || [];

    assert.ok(
      !JSON.stringify(args).includes('--exit-code'),
      'the engine reads the JSON, not the status — passing --exit-code would couple it to one'
    );
  });
});
