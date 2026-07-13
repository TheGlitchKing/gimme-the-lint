'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const adapters = require('../lib/adapters');
const { TIER, STAGE } = require('../lib/adapters/adapter');
const gitRef = require('../lib/git-ref');
const projectModel = require('../lib/project-model');
const { fingerprint } = require('../lib/fingerprint');

// SCHEMA-FIRST languages: the file on disk IS the contract, and the code is generated
// FROM it. So there is a real artifact to lint and a real artifact to diff — nothing
// to materialize, and nothing of ours to overwrite.
//
// (The mirror image is openapi.js: a code-first FastAPI app has no such file, so we
// derive one. The two look similar and solve opposite problems — one reads a spec
// somebody wrote, the other writes down a spec nobody did.)

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-idl-'));
  execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir });
  return dir;
}

function commit(dir, message) {
  execSync(`git add -A && git commit -q -m "${message}" --allow-empty`, { cwd: dir });
}

test.describe('buf: two adapters over one binary', () => {
  test('lint and breaking are registered SEPARATELY', () => {
    // The separation is the point: a team will very reasonably carry lint debt in a
    // large proto tree for a quarter while accepting exactly ZERO breaking changes.
    // Fold them into one adapter and the only way to grandfather the lint debt is to
    // grandfather the breakage too.
    assert.ok(adapters.hasAdapter('buf'));
    assert.ok(adapters.hasAdapter('buf-breaking'));
  });

  test('lint is commit-stage; breaking is push-stage and reference-tier', () => {
    const lint = adapters.getAdapter('buf', { projectRoot: '/tmp', appRoot: '/tmp' });
    const breaking = adapters.getAdapter('buf-breaking', { projectRoot: '/tmp', appRoot: '/tmp' });

    assert.strictEqual(lint.tier, TIER.LOCAL);
    assert.strictEqual(lint.stage, STAGE.COMMIT);

    // Needs git HISTORY (but no network), and runs on push: on a feature branch you
    // may legitimately break the schema in commit 3 and repair it in commit 7.
    // Blocking commit 3 would be pedantry. What must never happen is the branch
    // REACHING the base with the break still in it.
    assert.strictEqual(breaking.tier, TIER.REFERENCE);
    assert.strictEqual(breaking.stage, STAGE.PUSH);
  });

  test('buf emits JSON LINES, not a JSON array', () => {
    // Parsing it with a single JSON.parse() returns nothing — and "nothing" is
    // indistinguishable from a clean repo. A parser that silently reports success on
    // output it cannot read is the worst possible parser.
    const a = adapters.getAdapter('buf', { projectRoot: '/proj', appRoot: '/proj' });
    a._runCwd = '/proj';

    const out = [
      JSON.stringify({ path: 'user.proto', start_line: 3, type: 'FIELD_LOWER_SNAKE_CASE', message: 'Field name should be lower_snake_case.' }),
      JSON.stringify({ path: 'user.proto', start_line: 9, type: 'ENUM_ZERO_VALUE_SUFFIX', message: 'Enum zero value should be suffixed _UNSPECIFIED.' }),
    ].join('\n');

    const violations = a.parse(out);

    assert.strictEqual(violations.length, 2);
    assert.strictEqual(violations[0].ruleId, 'buf/FIELD_LOWER_SNAKE_CASE');
  });

  test('a breaking change is identified by the ELEMENT, not the file', () => {
    // A .proto tree gets reorganized far more often than source code does
    // (proto/v1/ -> proto/user/v1/). Keying on the file would evaporate the baseline
    // on the move and resurrect every finding it had grandfathered.
    const a = adapters.getAdapter('buf-breaking', { projectRoot: '/proj', appRoot: '/proj' });
    a._runCwd = '/proj';

    const mk = (file) =>
      a.parse(
        JSON.stringify({
          path: file,
          start_line: 12,
          type: 'FIELD_NO_DELETE',
          message: 'Previously present field "2" with name "email" on message "User" was deleted.',
        })
      )[0];

    assert.strictEqual(
      fingerprint(mk('proto/v1/user.proto')),
      fingerprint(mk('proto/user/v1/user.proto')),
      'moving the file must not resurrect a grandfathered finding'
    );
  });
});

test.describe('the base ref: git IS the snapshot', () => {
  test('a repo with a main branch resolves it', () => {
    const dir = tmpRepo();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    commit(dir, 'first');
    execSync('git branch -M main', { cwd: dir });

    const base = gitRef.resolveBaseRef(dir);

    assert.ok(base);
    assert.strictEqual(base.ref, 'main');
    assert.match(base.sha, /^[0-9a-f]{40}$/);
  });

  test('a configured ref always wins', () => {
    // Trunk-based and release-branch repos disagree about what "the base" means, and
    // we are not going to be right about that by guessing.
    const dir = tmpRepo();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    commit(dir, 'first');
    execSync('git branch -M main && git branch release/2.0', { cwd: dir });

    assert.strictEqual(gitRef.resolveBaseRef(dir, 'release/2.0').ref, 'release/2.0');
  });

  test('NO base ref is a skip, not a failure', () => {
    // Genuinely unavailable in ordinary, blameless situations: a shallow CI clone
    // (fetch-depth: 1 is the DEFAULT), a detached HEAD, a fresh repo, a fork with no
    // upstream. Failing there means the check goes red for reasons that have nothing
    // to do with the code — and a check that cries wolf on clean code gets switched
    // off, taking its real findings with it.
    const dir = tmpRepo(); // no commits, no branches

    assert.strictEqual(gitRef.resolveBaseRef(dir), null);
  });

  test('the skip reason tells a human what to actually DO', () => {
    const dir = tmpRepo();

    const reason = gitRef.explainMissingBase(dir);

    assert.match(reason, /no base branch found|shallow/);
  });

  test('a configured ref that does not exist explains ITSELF, not the environment', () => {
    const dir = tmpRepo();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    commit(dir, 'first');

    const reason = gitRef.explainMissingBase(dir, 'origin/nope');

    assert.match(reason, /origin\/nope/, 'name the ref they configured');
  });

  test('buf-breaking SKIPS rather than failing when there is no base', () => {
    const dir = tmpRepo();
    const a = adapters.getAdapter('buf-breaking', { projectRoot: dir, appRoot: dir });

    assert.throws(
      () => a.buildCommand([], {}),
      (err) => {
        assert.strictEqual(err.code, 'ADAPTER_SKIPPED', 'must skip, never block a push');
        return true;
      }
    );
  });
});

test.describe('spectral: a hand-authored spec', () => {
  test('it is local-tier, commit-stage', () => {
    const a = adapters.getAdapter('spectral', { projectRoot: '/tmp', appRoot: '/tmp' });
    assert.strictEqual(a.tier, TIER.LOCAL);
    assert.strictEqual(a.stage, STAGE.COMMIT);
  });

  test('it does NOT lint a lockfile that we generated', () => {
    // Linting our own output would report on a document the user never wrote and
    // cannot meaningfully edit — every finding unactionable, every one of them noise.
    // The lockfile is openapi.js's business, not spectral's.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-spectral-'));
    fs.writeFileSync(
      path.join(dir, 'openapi.json'),
      JSON.stringify({ openapi: '3.1.0', 'x-generated-by': 'gimme-the-lint' })
    );

    const a = adapters.getAdapter('spectral', { projectRoot: dir, appRoot: dir });

    assert.strictEqual(a.detect(dir), false, 'our own lockfile is not a spec to lint');
  });

  test('it DOES lint a hand-authored spec', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-spectral-'));
    fs.writeFileSync(
      path.join(dir, 'openapi.yaml'),
      'openapi: 3.1.0\ninfo:\n  title: Written by a person\n'
    );

    const a = adapters.getAdapter('spectral', { projectRoot: dir, appRoot: dir });

    assert.strictEqual(a.detect(dir), true);
  });

  test('a finding is identified by its JSON Pointer, not its line', () => {
    // A spec grows by insertion, so line numbers move constantly. A line-based
    // identity would churn the baseline on every unrelated addition, and a baseline
    // that churns is a baseline nobody trusts.
    const a = adapters.getAdapter('spectral', { projectRoot: '/proj', appRoot: '/proj' });
    a._runCwd = '/proj';

    const mk = (line) =>
      a.parse(
        JSON.stringify([
          {
            source: '/proj/openapi.yaml',
            code: 'operation-description',
            message: 'Operation must have a description.',
            severity: 1,
            range: { start: { line, character: 2 } },
            path: ['paths', '/deals', 'post'],
          },
        ])
      )[0];

    assert.strictEqual(fingerprint(mk(40)), fingerprint(mk(220)));
  });
});

test.describe('discovery', () => {
  test('a bare .proto directory binds buf AND buf-breaking', () => {
    // buf.yaml is optional, and a proto tree with no buf.yaml is exactly the tree most
    // likely to have never been checked. Shipping the linter without the breaking
    // check would guard a schema's STYLE while leaving its compatibility — the only
    // thing a client of it actually depends on — completely unwatched.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-proto-'));
    fs.writeFileSync(path.join(dir, 'user.proto'), 'syntax = "proto3";\n');

    const apps = projectModel.discoverApps(dir);

    assert.deepStrictEqual(apps[0].linters.sort(), ['buf', 'buf-breaking']);
  });

  test('an openapi.yaml binds spectral', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-spec-'));
    fs.writeFileSync(path.join(dir, 'openapi.yaml'), 'openapi: 3.1.0\n');

    const apps = projectModel.discoverApps(dir);

    assert.ok(apps[0].linters.includes('spectral'));
  });

  test('a random .yaml does NOT bind spectral', () => {
    // A repo is full of YAML that is not an API spec: CI workflows, manifests,
    // fixtures. Handing those to spectral produces a torrent of findings about
    // documents nobody ever meant as OpenAPI — the fastest possible way to teach
    // somebody to uninstall a linter.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-yaml-'));
    fs.writeFileSync(path.join(dir, 'docker-compose.yaml'), 'services: {}\n');
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module x\n');

    const apps = projectModel.discoverApps(dir);

    assert.ok(!apps[0].linters.includes('spectral'));
  });
});
