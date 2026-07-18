'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const adapters = require('../lib/adapters');
const { TIER, STAGE } = require('../lib/adapters/adapter');
const { fingerprint } = require('../lib/fingerprint');
const { redactMessage } = require('../lib/adapters/typecheck-identity');

// tsc and mypy are tested together because they are one design, not two: both are
// WHOLE-PROGRAM checkers, both therefore ignore the file list they are handed, and
// both key their violations on the SHAPE of the error rather than its text. Splitting
// the file would split that argument in half.

const tsc = () => adapters.getAdapter('tsc', { projectRoot: '/tmp', appRoot: '/tmp' });
const mypy = () => adapters.getAdapter('mypy', { projectRoot: '/tmp', appRoot: '/tmp' });

// ---------------------------------------------------------------------------------
test.describe('tsc: parsing real diagnostics', () => {
  test('a plain error yields file, position, code and message', () => {
    const [v] = tsc().parse(
      "src/lead.ts(12,5): error TS2345: Argument of type 'Prospect' is not assignable to parameter of type 'Lead'."
    );
    assert.strictEqual(v.file, 'src/lead.ts');
    assert.strictEqual(v.line, 12);
    assert.strictEqual(v.col, 5);
    assert.strictEqual(v.ruleId, 'TS2345');
    assert.strictEqual(v.severity, 'error');
    assert.match(v.message, /not assignable/);
  });

  test('an indented continuation line is folded into the message it explains', () => {
    // Dropping it leaves the headline unactionable: "Type X is not assignable to Y"
    // without the reason is a puzzle, not a diagnosis.
    const [v] = tsc().parse(
      [
        "src/a.ts(1,1): error TS2322: Type 'A' is not assignable to type 'B'.",
        "  Types of property 'id' are incompatible.",
      ].join('\n')
    );
    assert.match(v.message, /Types of property .* are incompatible/);
  });

  test('a project-level error with no file is anchored to the tsconfig', () => {
    // TS18003 and friends carry no filename. Dropping them would mean a run that
    // type-checked NOTHING could report zero violations and pass.
    const [v] = tsc().parse(
      'error TS18003: No inputs were found in config file.'
    );
    assert.strictEqual(v.file, 'tsconfig.json');
    assert.strictEqual(v.ruleId, 'TS18003');
  });

  test('clean output is zero violations', () => {
    assert.deepStrictEqual(tsc().parse(''), []);
  });
});

// ---------------------------------------------------------------------------------
test.describe('mypy: parsing real diagnostics', () => {
  test('an error yields file, position, code and message', () => {
    const [v] = mypy().parse(
      'app/svc.py:44:9: error: Incompatible return value type (got "Prospect", expected "Lead")  [return-value]'
    );
    assert.strictEqual(v.file, 'app/svc.py');
    assert.strictEqual(v.line, 44);
    assert.strictEqual(v.col, 9);
    assert.strictEqual(v.ruleId, 'return-value');
    assert.match(v.message, /Incompatible return value type/);
  });

  test('the column is optional — a user config can turn it off', () => {
    const [v] = mypy().parse('app/svc.py:44: error: Name "x" is not defined  [name-defined]');
    assert.strictEqual(v.line, 44);
    assert.strictEqual(v.ruleId, 'name-defined');
  });

  test('a note is folded into the error above it, never reported alone', () => {
    // mypy emits several notes per error. Reported on their own they would block a
    // push over something that is not a finding; dropped, they take the reason with
    // them.
    const out = mypy().parse(
      [
        'app/a.py:1:1: error: Incompatible types  [assignment]',
        'app/a.py:1:1: note: Consider using a Protocol here',
      ].join('\n')
    );
    assert.strictEqual(out.length, 1, 'the note must not become its own violation');
    assert.match(out[0].message, /Consider using a Protocol/);
  });

  test('an error with no code still gets a stable rule id', () => {
    const [v] = mypy().parse('app/a.py:1:1: error: Something went wrong');
    assert.strictEqual(v.ruleId, 'mypy-error');
  });
});

// ---------------------------------------------------------------------------------
test.describe('IDENTITY: a type rename must not churn the baseline', () => {
  // The reason these adapters key on shape instead of text. A type checker names the
  // types in its message, so renaming one rewrites every message that mentions it.
  // Under the default file+rule+message identity, a pure rename would retire every
  // affected fingerprint and introduce an equal number of "new" violations — turning
  // a no-op refactor into a blocked push, whose only practical remedy is to
  // re-baseline everything. A baseline you re-cut under pressure is not a ratchet.

  test('tsc: renaming a type leaves the fingerprint untouched', () => {
    const before = tsc().parse(
      "src/a.ts(3,1): error TS2345: Argument of type 'Prospect' is not assignable to parameter of type 'Lead'."
    )[0];
    const after = tsc().parse(
      "src/a.ts(3,1): error TS2345: Argument of type 'Contact' is not assignable to parameter of type 'Lead'."
    )[0];

    assert.notStrictEqual(before.message, after.message, 'the message must really differ');
    assert.strictEqual(fingerprint(before), fingerprint(after));
  });

  test('mypy: same, across its double-quoted style', () => {
    const before = mypy().parse(
      'app/a.py:3:1: error: Incompatible return value type (got "Prospect", expected "Lead")  [return-value]'
    )[0];
    const after = mypy().parse(
      'app/a.py:3:1: error: Incompatible return value type (got "Contact", expected "Lead")  [return-value]'
    )[0];
    assert.strictEqual(fingerprint(before), fingerprint(after));
  });

  test('but a genuinely different error in the same file is a different fingerprint', () => {
    // The stability must not be bought with blindness.
    const a = tsc().parse("src/a.ts(3,1): error TS2345: Argument of type 'X' is not assignable to parameter of type 'Y'.")[0];
    const b = tsc().parse("src/a.ts(9,1): error TS2339: Property 'zip' does not exist on type 'Prospect'.")[0];
    assert.notStrictEqual(fingerprint(a), fingerprint(b));
  });

  test('and the same error in a different file is a different fingerprint', () => {
    // The keyed scheme drops `file`, so the adapter has to put it back. If it forgot,
    // one fixed error would appear to fix its twin in an unrelated file.
    const a = tsc().parse("src/a.ts(3,1): error TS2345: Argument of type 'X' is not assignable to parameter of type 'Y'.")[0];
    const b = tsc().parse("src/b.ts(3,1): error TS2345: Argument of type 'X' is not assignable to parameter of type 'Y'.")[0];
    assert.notStrictEqual(fingerprint(a), fingerprint(b));
  });

  test('moving code within a file does not change identity', () => {
    // The original promise of the whole engine — line numbers are not identity.
    const a = tsc().parse("src/a.ts(3,1): error TS2339: Property 'zip' does not exist on type 'Lead'.")[0];
    const b = tsc().parse("src/a.ts(87,4): error TS2339: Property 'zip' does not exist on type 'Lead'.")[0];
    assert.strictEqual(fingerprint(a), fingerprint(b));
  });

  test('redaction covers both quoting styles and collapses whitespace', () => {
    assert.strictEqual(redactMessage("Type 'A' vs \"B\""), "Type '…' vs '…'");
    assert.strictEqual(redactMessage('a   b\n c'), 'a b c');
  });
});

// ---------------------------------------------------------------------------------
test.describe('WHOLE-PROGRAM: the file list is ignored on purpose', () => {
  // A type checker handed only the staged files answers a weaker question and misses
  // the errors that matter most — the ones a change causes in files it never touched.
  // The engine's diff is set-vs-set against the full baseline, so checking everything
  // every time is not just safe, it is what makes caller-breakage visible.

  test('tsc builds the same command whether or not targets are supplied', () => {
    const withTargets = tsc().buildCommand(['src/only-this-one.ts'], {});
    const without = tsc().buildCommand([], {});
    assert.deepStrictEqual(withTargets.args, without.args);
    assert.ok(withTargets.args.includes('--noEmit'));
  });

  test('mypy builds the same command whether or not targets are supplied', () => {
    const withTargets = mypy().buildCommand(['app/only-this-one.py'], {});
    const without = mypy().buildCommand([], {});
    assert.deepStrictEqual(withTargets.args, without.args);
  });

  test('neither claims an autofix', () => {
    // Both would otherwise inherit the "AUTOMATICALLY run --fix" guidance, which for
    // a type error is a dead end that ends at `baseline`.
    assert.strictEqual(tsc().supportsFix, false);
    assert.strictEqual(mypy().supportsFix, false);
  });

  test('both are local tier, push stage', () => {
    for (const a of [tsc(), mypy()]) {
      assert.strictEqual(a.tier, TIER.LOCAL, `${a.id}: needs no network`);
      assert.strictEqual(a.stage, STAGE.PUSH, `${a.id}: too slow for every commit`);
    }
  });
});

// ---------------------------------------------------------------------------------
test.describe('the payoff: breakage in an UNTOUCHED file still blocks', () => {
  // This is the entire reason to add a type checker to a progressive-lint engine, and
  // it is the one behavior a per-file adapter cannot deliver. You change a signature
  // in a.ts; the error lands in b.ts, which your commit never touched. A checker
  // handed only the staged files reports clean, and the break reaches the base branch
  // with a green tick on it.
  //
  // It works because the adapter checks everything and diff-engine compares the full
  // result against the full baseline — no scope, no line matching. Pinned here so a
  // future "optimization" that passes `targets` through cannot land quietly.

  test('a new error in an unstaged file is reported as NEW', async () => {
    const { checkUnit } = require('../lib/check');
    const { createViolation } = require('../lib/violation');
    const baselineStore = require('../lib/baseline-store');
    const { execSync } = require('child_process');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-wholeprog-'));
    execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir });
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(dir, 'src', 'b.ts'), 'export const b = 2;\n');
    execSync('git add -A && git commit -qm init', { cwd: dir });

    const known = createViolation({
      file: 'src/b.ts',
      ruleId: 'TS2339',
      message: 'old',
      fingerprintKey: 'src/b.ts::TS2339::old',
    });
    const broken = createViolation({
      file: 'src/b.ts',
      ruleId: 'TS2345',
      message: 'caller broken by a change in a.ts',
      fingerprintKey: 'src/b.ts::TS2345::caller broken',
    });

    const baselinePath = path.join(dir, '.gtl', 'apps', 'root', 'baseline.json');
    await baselineStore.writeBaseline(
      baselinePath,
      baselineStore.setLinterSection(
        baselineStore.emptyBaseline(),
        'tsc',
        baselineStore.createLinterSection([known], { toolVersion: '5', configHash: 'h' })
      )
    );

    // Stage ONLY a.ts. The new error is in b.ts, which is not staged.
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 99;\n');
    execSync('git add src/a.ts', { cwd: dir });

    // The real adapter, with only the subprocess replaced — so tier, stage and the
    // targets-ignoring contract are all genuinely exercised.
    const adapter = adapters.getAdapter('tsc', { projectRoot: dir, appRoot: dir });
    adapter.available = () => true;
    adapter.lint = () => [known, broken];

    const unit = { id: 'root', appPath: '.', root: dir, baselinePath, linters: ['tsc'] };
    const result = await checkUnit(dir, unit, adapter, { changedOnly: true, stage: 'push' });

    assert.strictEqual(result.status, 'fail');
    assert.strictEqual(result.diff.new.length, 1);
    assert.strictEqual(result.diff.new[0].file, 'src/b.ts');
    assert.strictEqual(result.diff.baselined.length, 1, 'the known error stays grandfathered');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------------
test.describe('tsc binds only where there is a program to check', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-tsc-'));

  test('a tsconfig means yes', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
    const a = adapters.getAdapter('tsc', { projectRoot: dir, appRoot: dir });
    assert.strictEqual(a.detect(dir), true);
  });

  test('TypeScript source with no tsconfig anywhere means NO', () => {
    // Silent no-op, not a skip: a repo with one stray .d.ts should hear nothing, and
    // `tsc --noEmit` with no project would either fail or adopt a parent config by
    // accident.
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'stray.ts'), 'export const x = 1;\n');
    const a = adapters.getAdapter('tsc', { projectRoot: dir, appRoot: dir });
    assert.strictEqual(a.detect(dir), false);
  });
});
