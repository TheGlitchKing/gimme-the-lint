'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const adapters = require('../lib/adapters');
const { LinterAdapter } = require('../lib/adapters/adapter');
const EslintAdapter = require('../lib/adapters/eslint');
const RuffAdapter = require('../lib/adapters/ruff');

const TMP = path.join(os.tmpdir(), `gimme-test-adapters-${Date.now()}`);

describe('adapter registry', () => {
  it('lists the built-in adapters', () => {
    const ids = adapters.listAdapters();
    assert.ok(ids.includes('eslint'));
    assert.ok(ids.includes('ruff'));
  });

  it('constructs adapters by id', () => {
    assert.ok(adapters.getAdapter('eslint') instanceof EslintAdapter);
    assert.ok(adapters.getAdapter('ruff') instanceof RuffAdapter);
  });

  it('throws on an unknown adapter id', () => {
    assert.throws(() => adapters.getAdapter('nope'), /Unknown linter adapter/);
  });

  it('reports adapter existence', () => {
    assert.strictEqual(adapters.hasAdapter('eslint'), true);
    assert.strictEqual(adapters.hasAdapter('nope'), false);
  });

  it('finds adapters by language', () => {
    const js = adapters.adaptersForLanguage('javascript').map((a) => a.id);
    assert.ok(js.includes('eslint') && js.includes('biome'));
    // Python has two, and they are not alternatives: ruff asks "is this code
    // well-formed?", contract asks "does the model agree with the schemas exposing
    // it?". Both run, and they baseline independently.
    const py = adapters.adaptersForLanguage('python');
    assert.deepStrictEqual(py.map((a) => a.id), ['ruff', 'contract', 'openapi', 'alembic-check']);
  });

  it('supports registering a custom adapter', () => {
    class CustomAdapter extends LinterAdapter {
      get id() {
        return 'custom-test';
      }
    }
    adapters.registerAdapter('custom-test', CustomAdapter);
    assert.ok(adapters.getAdapter('custom-test') instanceof CustomAdapter);
  });
});

describe('LinterAdapter base contract', () => {
  it('throws when buildCommand/parse are not implemented', () => {
    class Bare extends LinterAdapter {
      get id() {
        return 'bare';
      }
    }
    const bare = new Bare();
    assert.throws(() => bare.buildCommand([], {}), /not implemented/);
    assert.throws(() => bare.parse('', '', 0), /not implemented/);
  });

  it('resolveBinary prefers an existing path', async () => {
    const real = path.join(TMP, 'bin', 'tool');
    await fs.ensureFile(real);
    const eslint = new EslintAdapter();
    assert.strictEqual(eslint.resolveBinary([real, 'fallback']), real);
    assert.strictEqual(eslint.resolveBinary(['/no/such/path', 'fallback']), 'fallback');
  });
});

describe('adapter detection', () => {
  before(async () => {
    await fs.ensureDir(TMP);
    await fs.ensureDir(path.join(TMP, 'js-app'));
    await fs.writeFile(path.join(TMP, 'js-app', 'package.json'), '{}');
    // A real JS app has source — a bare package.json no longer self-detects.
    await fs.writeFile(path.join(TMP, 'js-app', 'index.js'), 'export const x = 1;\n');
    await fs.ensureDir(path.join(TMP, 'py-app'));
    await fs.writeFile(path.join(TMP, 'py-app', 'main.py'), 'x = 1\n');
    await fs.ensureDir(path.join(TMP, 'empty'));
  });

  after(async () => {
    await fs.remove(TMP);
  });

  it('eslint detects a directory with package.json', () => {
    assert.strictEqual(new EslintAdapter().detect(path.join(TMP, 'js-app')), true);
  });

  it('ruff detects a directory containing .py files', () => {
    assert.strictEqual(new RuffAdapter().detect(path.join(TMP, 'py-app')), true);
  });

  it('does not cross-detect languages', () => {
    assert.strictEqual(new EslintAdapter().detect(path.join(TMP, 'py-app')), false);
  });

  it('detects nothing in an empty directory', () => {
    assert.strictEqual(new EslintAdapter().detect(path.join(TMP, 'empty')), false);
    assert.strictEqual(new RuffAdapter().detect(path.join(TMP, 'nope')), false);
  });

  it('available() returns a boolean without throwing', () => {
    assert.strictEqual(typeof new EslintAdapter().available(), 'boolean');
    assert.strictEqual(typeof new RuffAdapter().available(), 'boolean');
  });
});

describe('EslintAdapter.parse', () => {
  const eslint = new EslintAdapter({ projectRoot: '/proj' });

  it('parses eslint --format=json into NormalizedViolations', () => {
    const json = JSON.stringify([
      {
        filePath: '/proj/src/a.js',
        messages: [
          {
            ruleId: 'no-unused-vars',
            severity: 2,
            message: "'x' is defined but never used.",
            line: 3,
            column: 7,
            endLine: 3,
            endColumn: 8,
          },
          {
            ruleId: 'eqeqeq',
            severity: 1,
            message: "Expected '===' and instead saw '=='.",
            line: 5,
            column: 10,
          },
        ],
      },
      { filePath: '/proj/src/b.js', messages: [] },
    ]);
    const violations = eslint.parse(json);
    assert.strictEqual(violations.length, 2);
    assert.strictEqual(violations[0].file, 'src/a.js', 'path must be relativized');
    assert.strictEqual(violations[0].ruleId, 'no-unused-vars');
    assert.strictEqual(violations[0].severity, 'error');
    assert.strictEqual(violations[0].source, 'eslint');
    assert.strictEqual(violations[1].severity, 'warning');
  });

  it('labels fatal parse errors', () => {
    const json = JSON.stringify([
      {
        filePath: '/proj/x.js',
        messages: [{ ruleId: null, fatal: true, severity: 2, message: 'Parsing error', line: 1, column: 1 }],
      },
    ]);
    assert.strictEqual(eslint.parse(json)[0].ruleId, 'fatal-parse-error');
  });

  it('returns [] for empty or non-JSON output', () => {
    assert.deepStrictEqual(eslint.parse(''), []);
    assert.deepStrictEqual(eslint.parse('not json'), []);
    assert.deepStrictEqual(eslint.parse('{}'), []);
  });
});

describe('RuffAdapter.parse', () => {
  const ruff = new RuffAdapter({ projectRoot: '/proj' });

  it('parses ruff --output-format=json into NormalizedViolations', () => {
    const json = JSON.stringify([
      {
        code: 'F401',
        message: '`os` imported but unused',
        filename: 'app/x.py',
        location: { row: 1, column: 1 },
        end_location: { row: 1, column: 10 },
      },
    ]);
    const violations = ruff.parse(json);
    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].file, 'app/x.py');
    assert.strictEqual(violations[0].ruleId, 'F401');
    assert.strictEqual(violations[0].line, 1);
    assert.strictEqual(violations[0].severity, 'error');
    assert.strictEqual(violations[0].source, 'ruff');
  });

  it('labels a null code as a syntax error', () => {
    const json = JSON.stringify([
      {
        code: null,
        message: 'SyntaxError: invalid syntax',
        filename: 'app/y.py',
        location: { row: 2, column: 3 },
      },
    ]);
    assert.strictEqual(ruff.parse(json)[0].ruleId, 'syntax-error');
  });

  it('returns [] for empty or non-JSON output', () => {
    assert.deepStrictEqual(ruff.parse(''), []);
    assert.deepStrictEqual(ruff.parse('garbage'), []);
  });
});

describe('adapter command construction', () => {
  it('eslint buildCommand includes --format=json and --fix', () => {
    const eslint = new EslintAdapter({ projectRoot: '/proj' });
    const plain = eslint.buildCommand(['src'], {});
    assert.ok(plain.args.includes('--format=json'));
    assert.ok(!plain.args.includes('--fix'));
    const fixed = eslint.buildCommand(['src'], { fix: true });
    assert.ok(fixed.args.includes('--fix'));
  });

  it('ruff buildCommand uses check + json output', () => {
    const ruff = new RuffAdapter({ projectRoot: '/proj' });
    const cmd = ruff.buildCommand(['app'], { fix: true });
    assert.strictEqual(cmd.args[0], 'check');
    assert.ok(cmd.args.includes('--output-format=json'));
    assert.ok(cmd.args.includes('--fix'));
    assert.ok(cmd.args.includes('app'));
  });
});
