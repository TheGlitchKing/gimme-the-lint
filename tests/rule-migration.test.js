'use strict';

// Regression tests for the v2.3.0 tflint audit, Task 5 — rule rename/removal
// migration. fingerprint() folds ruleId into violation identity, so an
// upstream rule rename orphans the baseline entry; `migrate --rules` reconciles
// the baseline through a per-linter alias map.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const adapters = require('../lib/adapters');
const { LinterAdapter } = require('../lib/adapters/adapter');
const { createViolation } = require('../lib/violation');
const { fingerprint } = require('../lib/fingerprint');
const ruleAliases = require('../lib/rule-aliases');
const { reconcileFingerprints, migrateRules } = require('../lib/migrate');
const { runBaseline } = require('../lib/baseline');
const { runCheck } = require('../lib/check');
const baselineStore = require('../lib/baseline-store');

describe('rule-aliases registry', () => {
  it('getAliases returns an empty map for a linter with no aliases', () => {
    assert.deepStrictEqual(ruleAliases.getAliases('eslint'), {});
    assert.deepStrictEqual(ruleAliases.getAliases('nonexistent'), {});
  });

  it('registerAliases extends a linter map', () => {
    ruleAliases.registerAliases('tflint', { old_x: 'new_x' });
    assert.strictEqual(ruleAliases.getAliases('tflint').old_x, 'new_x');
  });
});

describe('reconcileFingerprints', () => {
  it('rewrites a renamed rule old→new, preserving the grandfather count', () => {
    const oldV = createViolation({ file: 'main.tf', ruleId: 'old_rule', message: 'problem' });
    const oldFp = fingerprint(oldV);
    const newV = createViolation({ file: 'main.tf', ruleId: 'new_rule', message: 'problem' });

    const rec = reconcileFingerprints({ [oldFp]: 1 }, [newV], { old_rule: 'new_rule' });
    assert.strictEqual(rec.fingerprints[fingerprint(newV)], 1, 'count moved to the new fp');
    assert.ok(!(oldFp in rec.fingerprints), 'the orphaned old fp is gone');
    assert.strictEqual(rec.total, 1);
    assert.deepStrictEqual(rec.renamed, [{ from: 'old_rule', to: 'new_rule' }]);
  });

  it('drops a baseline entry for a violation that no longer occurs', () => {
    const goneFp = fingerprint(
      createViolation({ file: 'a.tf', ruleId: 'removed_rule', message: 'x' })
    );
    const rec = reconcileFingerprints({ [goneFp]: 2 }, [], {});
    assert.deepStrictEqual(rec.fingerprints, {});
    assert.strictEqual(rec.total, 0, 'total corrected');
    assert.strictEqual(rec.dropped.length, 1);
  });

  it('keeps a violation still occurring under the same rule id', () => {
    const v = createViolation({ file: 'c.tf', ruleId: 'keep', message: 'still here' });
    const fp = fingerprint(v);
    const rec = reconcileFingerprints({ [fp]: 1 }, [v], {});
    assert.strictEqual(rec.fingerprints[fp], 1);
  });

  it('never grandfathers a genuinely new violation', () => {
    const fresh = createViolation({ file: 'b.tf', ruleId: 'r', message: 'new problem' });
    const rec = reconcileFingerprints({}, [fresh], {});
    assert.deepStrictEqual(rec.fingerprints, {}, 'a new violation is not added to the baseline');
  });
});

// --- end-to-end: a rule rename through migrate --rules ----------------------

const ruleState = { ruleId: 'rule_old', message: 'a baselined problem' };

class FakeRuleAdapter extends LinterAdapter {
  get id() {
    return 'fakerule';
  }
  get languages() {
    return ['fakerule'];
  }
  get sourceExtensions() {
    return ['.fr'];
  }
  detect() {
    return true;
  }
  available() {
    return true;
  }
  version() {
    return '1.0.0';
  }
  configFiles() {
    return [];
  }
  lint() {
    return [
      createViolation({
        file: 'x.fr',
        ruleId: ruleState.ruleId,
        message: ruleState.message,
        source: 'fakerule',
      }),
    ];
  }
}

describe('migrateRules — end-to-end rule rename', () => {
  const TMP = path.join(os.tmpdir(), `gimme-rulemig-${Date.now()}`);

  before(async () => {
    adapters.registerAdapter('fakerule', FakeRuleAdapter);
    await fs.ensureDir(TMP);
    await fs.writeFile(
      path.join(TMP, 'gimme-the-lint.config.js'),
      "module.exports = { apps: { '.': { linters: ['fakerule'] } } };\n"
    );
    await fs.writeFile(path.join(TMP, 'x.fr'), 'code\n');
  });
  after(async () => {
    await fs.remove(TMP);
  });

  it('migrates a baseline through a rule rename so the grandfather survives', async () => {
    // 1. Baseline captures the violation under its OLD rule id.
    ruleState.ruleId = 'rule_old';
    await runBaseline(TMP);

    // 2. Upstream renames the rule: the linter now emits the NEW id.
    ruleState.ruleId = 'rule_new';

    // Without migration the renamed rule blocks as a "new" violation.
    const before = await runCheck(TMP, { changedOnly: false });
    assert.strictEqual(before.ok, false, 'renamed rule blocks before migration');

    // 3. Record the rename and run `migrate --rules`.
    ruleAliases.registerAliases('fakerule', { rule_old: 'rule_new' });
    const result = await migrateRules(TMP);
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(result.units[0].linters[0].renamed.length, 1);

    // 4. The baseline fingerprint was rewritten to the new rule id.
    const baseline = await baselineStore.readBaseline(
      path.join(TMP, '.gtl', 'apps', 'root', 'baseline.json')
    );
    const section = baselineStore.getLinterSection(baseline, 'fakerule');
    const newFp = fingerprint(
      createViolation({ file: 'x.fr', ruleId: 'rule_new', message: ruleState.message })
    );
    assert.ok(section.fingerprints[newFp], 'baseline now keyed by the new rule id');

    // 5. The violation is grandfathered again — the commit is no longer blocked.
    const after = await runCheck(TMP, { changedOnly: false });
    assert.strictEqual(after.ok, true, 'renamed rule is grandfathered after migration');
  });
});
