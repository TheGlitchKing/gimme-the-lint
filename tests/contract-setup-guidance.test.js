'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #20. `gimme-the-lint install` never installed the entity-contract checker — in ANY
// layout, not just the reporter's. It creates a venv, puts ruff and mypy in it, and
// stops. So the contract check skipped forever after a fresh install, and nothing said
// why.
//
// It still does not install it, and that is the right call: `gtl-contract` has to run in
// a venv that can import the APPLICATION, and the venv `install` creates holds linters.
// Putting the checker there yields a checker that loads, cannot import the app, and
// skips — present, green, verifying nothing.
//
// So `install` now prints the step instead of guessing. These tests guard the two ways
// that guidance rots: the path stops existing, or the doc it points at moves.

const ROOT = path.join(__dirname, '..');

test.describe('the pip target we tell people to install actually exists', () => {
  test('the vendored python package is where install says it is', () => {
    const pkg = path.join(ROOT, 'python');

    assert.ok(fs.existsSync(pkg), 'install prints this path; it must be real');
    assert.ok(
      fs.existsSync(path.join(pkg, 'pyproject.toml')),
      'and `pip install -e` it must be able to build it'
    );
  });

  test('it ships in the tarball, or the printed command fails for every consumer', () => {
    // The path we print lives under node_modules/@theglitchking/gimme-the-lint/python.
    // If `files` ever stops carrying python/, that command breaks for everyone while
    // continuing to work in this repo — the worst kind of rot.
    const files = require(path.join(ROOT, 'package.json')).files || [];

    assert.ok(
      files.some((f) => f === 'python' || f.startsWith('python/')),
      `package.json "files" must ship python/ — got ${JSON.stringify(files)}`
    );
  });
});

test.describe('the guidance points somewhere that exists', () => {
  function headings(file) {
    return fs
      .readFileSync(path.join(ROOT, file), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('#'))
      .map((l) =>
        l
          .replace(/^#+\s*/, '')
          .toLowerCase()
          .replace(/`/g, '')
          .replace(/[^\w\s-]/g, '')
          .trim()
          .replace(/\s/g, '-')
      );
  }

  // Anchors referenced from the CLI output, the README, and cross-doc links. A dead
  // anchor sends a reader who is already stuck to a page that does not answer them.
  const REFERENCED = [
    ['.documentation/api/contract-guide.md', 'where-the-contract-check-can-run'],
    ['.documentation/api/contract-guide.md', 'which-venv-gets-gtl-contract'],
    ['.documentation/api/contract-guide.md', 'running-gtl-contract-directly-and-its-exit-codes'],
  ];

  for (const [file, anchor] of REFERENCED) {
    test(`${file}#${anchor} resolves`, () => {
      assert.ok(
        headings(file).includes(anchor),
        `no heading yields #${anchor} in ${file}`
      );
    });
  }
});

test.describe('install reports the step rather than performing it', () => {
  test('installer exposes contractSetup with the package path', () => {
    // Read rather than executed: init() creates venvs and shells out to npm. What is
    // worth pinning is that the field exists and is wired to the vendored package.
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'installer.js'), 'utf8');

    assert.match(src, /results\.contractSetup\s*=/);
    assert.match(src, /pythonPackage:\s*path\.join\(__dirname, '\.\.', 'python'\)/);
  });

  test('the CLI says WHICH venv, because the wrong one skips silently', () => {
    const src = fs.readFileSync(path.join(ROOT, 'bin', 'gimme-the-lint.js'), 'utf8');

    assert.match(src, /IMPORTS YOUR APPLICATION/);
    assert.match(src, /SKIP/);
  });
});
