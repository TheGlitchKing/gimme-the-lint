'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const gitHooks = require('../lib/git-hooks-manager');

// Git hooks are installed FILES. `npm update` rewrites lib/; it cannot rewrite a
// hook a user installed months ago. So an upgraded engine can find itself driven
// by a hook that predates it and passes none of the flags it now expects — and the
// new checks silently never run.
//
// The user then gets a green hook, believes they are guarded, and is not. That is
// a guard reporting green while guarding nothing, which is the precise failure
// this whole engine exists to eliminate. It must not be how the engine ships.

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-hooks-'));
  execSync('git init -q', { cwd: dir });
  return dir;
}

function writeHook(repo, name, content) {
  const p = path.join(repo, '.git', 'hooks', name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

test.describe('hookContractVersion', () => {
  test('reads the declared contract version', () => {
    assert.strictEqual(gitHooks.hookContractVersion('# gtl-hook-contract: 2\n'), 2);
    assert.strictEqual(gitHooks.hookContractVersion('# gtl-hook-contract:7'), 7);
  });

  test('a hook with no marker is version 0 (pre-versioning)', () => {
    assert.strictEqual(gitHooks.hookContractVersion('#!/bin/bash\ngimme-the-lint check\n'), 0);
    assert.strictEqual(gitHooks.hookContractVersion(''), 0);
    assert.strictEqual(gitHooks.hookContractVersion(null), 0);
  });
});

test.describe('getStatus detects a stale hook', () => {
  test('an old gimme-the-lint hook reports "stale", not "installed"', async () => {
    const repo = tmpRepo();
    // Exactly what a v2.5.2 user has sitting in .git/hooks right now: ours,
    // functional, exits 0 — and unaware of every flag added since.
    writeHook(repo, 'pre-commit', '#!/usr/bin/env bash\n# gimme-the-lint: Pre-Commit Hook\nexit 0\n');

    const status = await gitHooks.getStatus(repo);

    assert.strictEqual(status.hooks['pre-commit'], 'stale');
    assert.deepStrictEqual(status.stale, ['pre-commit']);
  });

  test('a current hook reports "installed" and is not stale', async () => {
    const repo = tmpRepo();
    writeHook(
      repo,
      'pre-commit',
      `#!/usr/bin/env bash\n# gimme-the-lint\n# gtl-hook-contract: ${gitHooks.HOOK_CONTRACT_VERSION}\nexit 0\n`
    );

    const status = await gitHooks.getStatus(repo);

    assert.strictEqual(status.hooks['pre-commit'], 'installed');
    assert.deepStrictEqual(status.stale, []);
  });

  test("someone else's hook is left alone, not called stale", async () => {
    const repo = tmpRepo();
    writeHook(repo, 'pre-commit', '#!/usr/bin/env bash\n# husky\nexit 0\n');

    const status = await gitHooks.getStatus(repo);

    // Not ours to judge, and certainly not ours to nag about.
    assert.strictEqual(status.hooks['pre-commit'], 'other');
    assert.deepStrictEqual(status.stale, []);
  });

  test('a missing hook is missing, not stale', async () => {
    const repo = tmpRepo();
    const status = await gitHooks.getStatus(repo);

    assert.strictEqual(status.hooks['pre-commit'], 'missing');
    assert.deepStrictEqual(status.stale, []);
  });
});

test.describe('installHooks clears staleness', () => {
  test('re-installing over a stale hook brings it to the current contract', async () => {
    const repo = tmpRepo();
    writeHook(repo, 'pre-commit', '#!/usr/bin/env bash\n# gimme-the-lint\nexit 0\n');
    writeHook(repo, 'pre-push', '#!/usr/bin/env bash\n# gimme-the-lint\nexit 0\n');

    const before = await gitHooks.getStatus(repo);
    assert.deepStrictEqual(before.stale.sort(), ['pre-commit', 'pre-push']);

    await gitHooks.installHooks(repo);

    const after = await gitHooks.getStatus(repo);
    assert.deepStrictEqual(after.stale, [], 'the documented remedy must actually work');
    assert.strictEqual(after.hooks['pre-commit'], 'installed');
    assert.strictEqual(after.hooks['pre-push'], 'installed');
  });
});

test.describe('the shipped hooks declare the current contract', () => {
  // Guards the boring, fatal mistake: bumping HOOK_CONTRACT_VERSION in the manager
  // and forgetting to bump the marker in the hook files themselves — which would
  // make every freshly-installed hook report itself as stale, forever.
  for (const hook of ['pre-commit', 'pre-push']) {
    test(`githooks/${hook} carries contract ${gitHooks.HOOK_CONTRACT_VERSION}`, () => {
      const content = fs.readFileSync(path.join(__dirname, '..', 'githooks', hook), 'utf8');
      assert.strictEqual(
        gitHooks.hookContractVersion(content),
        gitHooks.HOOK_CONTRACT_VERSION
      );
    });

    test(`githooks/${hook} passes an explicit --stage`, () => {
      const content = fs.readFileSync(path.join(__dirname, '..', 'githooks', hook), 'utf8');
      assert.match(content, /--stage=/, 'the hook must pin its stage, not rely on the default');
    });
  }

  test('pre-commit runs the commit stage; pre-push runs the push stage', () => {
    const read = (h) => fs.readFileSync(path.join(__dirname, '..', 'githooks', h), 'utf8');
    assert.match(read('pre-commit'), /--stage=commit/);
    assert.match(read('pre-push'), /--stage=push/);
    assert.doesNotMatch(
      read('pre-commit'),
      /--stage=push/,
      'the commit hook must never run push-stage checks'
    );
  });
});
