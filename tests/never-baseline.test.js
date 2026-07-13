'use strict';

const test = require('node:test');
const assert = require('node:assert');

const baselineStore = require('../lib/baseline-store');
const diffEngine = require('../lib/diff-engine');
const { fingerprint } = require('../lib/fingerprint');
const { createViolation } = require('../lib/violation');
const { formatBaselineReport } = require('../lib/report');

// DEFECT vs DEBT — the one place this tool stops being progressive.
//
// Its whole thesis is that existing violations get grandfathered and only NEW ones
// block. That is right for DEBT: a gap, a hole, an app that works but is not ideal.
// Grandfathering is exactly what makes adoption possible on a mature codebase.
//
// It is wrong for a DEFECT: something broken RIGHT NOW, for everyone, regardless of
// what anyone does next. Grandfathering one means writing down "we accept that every
// read of this entity returns a 500" — a sentence nobody would say out loud. So the
// tool will not say it for them.
//
// (The predicate is not "returns a 500". `update-has-create-default` returns a
// cheerful 200 while overwriting the user's stored data on every save. That is worse
// than a 500, because a 500 is loud.)
//
// This is the rule people will most want to work around, so there are THREE
// independent gates, and each test below tries to defeat one.

const debt = () =>
  createViolation({
    file: 'app/schemas/deal.py',
    ruleId: 'contract/column-not-writable',
    message: 'No write schema accepts `operating_expenses`.',
    fingerprintKey: 'Deal.operating_expenses:writable',
  });

const defect = () =>
  createViolation({
    file: 'app/schemas/conversation.py',
    ruleId: 'contract/reserved-metadata-unaliased',
    message: 'a 500 on every read of this entity, forever',
    fingerprintKey: 'Conversation.metadata:reserved',
    neverBaseline: true,
  });

test.describe('GATE 1 — baseline capture excludes defects', () => {
  test('a defect is physically absent from the fingerprint map', () => {
    // Not "discouraged from being grandfathered". ABSENT from the file that does the
    // grandfathering. Running `baseline` deliberately, twice, with intent, will not
    // put it there.
    const map = baselineStore.buildFingerprintMap([debt(), defect()]);

    assert.ok(map[fingerprint(debt())], 'debt must be captured');
    assert.strictEqual(map[fingerprint(defect())], undefined, 'a defect must not be captured');
    assert.strictEqual(Object.keys(map).length, 1);
  });

  test('the section total reflects what was actually captured', () => {
    const section = baselineStore.createLinterSection([debt(), defect(), defect()]);
    assert.strictEqual(Object.keys(section.fingerprints).length, 1);
  });

  test('the refused violations are recoverable, for reporting', () => {
    const refused = baselineStore.unbaselineable([debt(), defect()]);
    assert.strictEqual(refused.length, 1);
    assert.strictEqual(refused[0].ruleId, 'contract/reserved-metadata-unaliased');
  });

  test('a baseline of ONLY defects captures nothing at all', () => {
    const map = baselineStore.buildFingerprintMap([defect(), defect()]);
    assert.deepStrictEqual(map, {});
  });
});

test.describe('GATE 2 — the diff engine ignores a planted defect', () => {
  test('a hand-planted defect fingerprint in the baseline does NOT suppress it', () => {
    // THE attack. Gate 1 means a baseline written by this version cannot contain a
    // defect — so the way around it is to put one there yourself: edit the JSON,
    // paste in the hash, make the noise stop.
    //
    // Trusting the file would make the guarantee only as strong as the least careful
    // edit anyone ever made to it. The whole point is that it does not depend on
    // anyone's care.
    const planted = { [fingerprint(defect())]: 1 };

    const result = diffEngine.diff([defect()], planted);

    assert.strictEqual(result.new.length, 1, 'the defect must still block');
    assert.strictEqual(result.baselined.length, 0, 'it must NOT be treated as grandfathered');
  });

  test('planting a huge count does not help either', () => {
    const planted = { [fingerprint(defect())]: 999 };
    const result = diffEngine.diff([defect(), defect()], planted);
    assert.strictEqual(result.new.length, 2);
  });

  test('debt in the same baseline is still honored', () => {
    // The gate must be surgical. If it broke normal baselining, people would turn the
    // whole thing off — and then the defects would not be caught either.
    const baseline = {
      [fingerprint(debt())]: 1,
      [fingerprint(defect())]: 1,
    };

    const result = diffEngine.diff([debt(), defect()], baseline);

    assert.strictEqual(result.baselined.length, 1);
    assert.strictEqual(result.baselined[0].ruleId, 'contract/column-not-writable');
    assert.strictEqual(result.new.length, 1);
    assert.strictEqual(result.new[0].ruleId, 'contract/reserved-metadata-unaliased');
  });

  test('a legacy baseline written before the rule was classified is not trusted', () => {
    // The realistic version of the attack: nobody edited anything maliciously, the
    // baseline is simply OLD — captured when this rule was still considered debt.
    // The file is honest; it is just wrong now. Same answer.
    const legacy = { [fingerprint(defect())]: 3 };
    const result = diffEngine.diff([defect()], legacy);
    assert.strictEqual(result.new.length, 1);
  });
});

test.describe('GATE 3 — `baseline` says what it refused to capture', () => {
  test('the report names the refused violations and explains why', () => {
    // Without this, a user runs the command they were TOLD to run to clear the decks,
    // sees success, and is then blocked on their next push by findings they believe
    // they just baselined. They conclude the tool is broken — and they are not being
    // unreasonable.
    const out = formatBaselineReport(
      {
        unitCount: 1,
        units: [{ appPath: '.', baselinePath: '/tmp/b.json', sections: [] }],
        incomplete: [],
        unbaselineable: [
          {
            app: '.',
            linter: 'contract',
            violation: defect(),
          },
        ],
      },
      '/tmp'
    );

    assert.match(out, /1 violation\(s\) were NOT baselined/);
    assert.match(out, /block your next push/);
    assert.match(out, /500/, 'it must say WHY, not merely that it refused');
    // And it must point at the escape hatch, or the user is simply stuck.
    assert.match(out, /\.gtl\/config\.js with a reason/);
    assert.match(out, /Re-running `baseline` will not/);
  });

  test('a clean baseline says nothing about defects', () => {
    const out = formatBaselineReport(
      {
        unitCount: 1,
        units: [{ appPath: '.', baselinePath: '/tmp/b.json', sections: [] }],
        incomplete: [],
        unbaselineable: [],
      },
      '/tmp'
    );
    assert.doesNotMatch(out, /NOT baselined/);
  });
});

test.describe('debt is still fully baselineable', () => {
  test('the ordinary case is untouched', () => {
    // Everything above is worthless if it broke normal progressive linting: a tool
    // that blocks on pre-existing debt is a tool nobody installs, and an uninstalled
    // tool catches no defects at all.
    const baseline = baselineStore.buildFingerprintMap([debt()]);
    const result = diffEngine.diff([debt()], baseline);

    assert.strictEqual(result.new.length, 0);
    assert.strictEqual(result.baselined.length, 1);
  });

  test('a SECOND instance of baselined debt still blocks', () => {
    const baseline = baselineStore.buildFingerprintMap([debt()]);
    const result = diffEngine.diff([debt(), debt()], baseline);

    assert.strictEqual(result.baselined.length, 1);
    assert.strictEqual(result.new.length, 1, 'counts, not sets — a new copy is new');
  });
});
