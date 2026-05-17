'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const adapters = require('../lib/adapters');
const GolangciLintAdapter = require('../lib/adapters/golangci-lint');
const ClippyAdapter = require('../lib/adapters/clippy');
const toolchain = require('../lib/toolchain');

describe('polyglot registry', () => {
  it('registers all four built-in adapters', () => {
    const ids = adapters.listAdapters();
    for (const id of ['eslint', 'ruff', 'golangci-lint', 'clippy']) {
      assert.ok(ids.includes(id), `expected ${id} in registry`);
    }
  });

  it('maps Go and Rust to their adapters by language', () => {
    assert.deepStrictEqual(
      adapters.adaptersForLanguage('go').map((a) => a.id),
      ['golangci-lint']
    );
    assert.deepStrictEqual(
      adapters.adaptersForLanguage('rust').map((a) => a.id),
      ['clippy']
    );
  });
});

describe('GolangciLintAdapter.parse', () => {
  const go = new GolangciLintAdapter({ projectRoot: '/proj' });

  it('parses the {Issues:[...]} report shape', () => {
    const json = JSON.stringify({
      Issues: [
        {
          FromLinter: 'errcheck',
          Text: 'Error return value is not checked',
          Severity: '',
          Pos: { Filename: 'main.go', Line: 10, Column: 2 },
        },
        {
          FromLinter: 'govet',
          Text: 'shadow: declaration shadows',
          Severity: 'warning',
          Pos: { Filename: 'pkg/util.go', Line: 4, Column: 1 },
        },
      ],
      Report: {},
    });
    const violations = go.parse(json);
    assert.strictEqual(violations.length, 2);
    assert.strictEqual(violations[0].file, 'main.go');
    assert.strictEqual(violations[0].ruleId, 'errcheck');
    assert.strictEqual(violations[0].severity, 'error');
    assert.strictEqual(violations[1].severity, 'warning');
    assert.strictEqual(violations[1].source, 'golangci-lint');
  });

  it('returns [] for empty or issue-free output', () => {
    assert.deepStrictEqual(go.parse(''), []);
    assert.deepStrictEqual(go.parse(JSON.stringify({ Issues: [], Report: {} })), []);
    assert.deepStrictEqual(go.parse('not json'), []);
  });

  it('builds a module-aware command', () => {
    const cmd = go.buildCommand([], { fix: true });
    assert.strictEqual(cmd.args[0], 'run');
    assert.ok(cmd.args.includes('--out-format=json'));
    assert.ok(cmd.args.includes('--fix'));
    assert.ok(cmd.args.includes('./...'));
  });
});

describe('ClippyAdapter.parse', () => {
  const clippy = new ClippyAdapter({ projectRoot: '/proj' });

  it('parses newline-delimited cargo JSON', () => {
    const ndjson = [
      JSON.stringify({
        reason: 'compiler-message',
        message: {
          code: { code: 'clippy::needless_return' },
          level: 'warning',
          message: 'unneeded `return` statement',
          spans: [
            {
              file_name: 'src/main.rs',
              line_start: 4,
              column_start: 5,
              line_end: 4,
              column_end: 18,
              is_primary: true,
            },
          ],
        },
      }),
      JSON.stringify({ reason: 'build-finished', success: true }),
    ].join('\n');

    const violations = clippy.parse(ndjson);
    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].file, 'src/main.rs');
    assert.strictEqual(violations[0].ruleId, 'clippy::needless_return');
    assert.strictEqual(violations[0].line, 4);
    assert.strictEqual(violations[0].severity, 'warning');
    assert.strictEqual(violations[0].source, 'clippy');
  });

  it('skips records without a source span (summaries, notes)', () => {
    const ndjson = JSON.stringify({
      reason: 'compiler-message',
      message: { level: 'warning', message: 'summary', spans: [] },
    });
    assert.deepStrictEqual(clippy.parse(ndjson), []);
  });

  it('returns [] for empty output', () => {
    assert.deepStrictEqual(clippy.parse(''), []);
  });
});

describe('toolchain', () => {
  it('reports availability for every registered linter', () => {
    const report = toolchain.checkToolchains();
    assert.strictEqual(report.length, adapters.listAdapters().length);
    for (const entry of report) {
      assert.strictEqual(typeof entry.available, 'boolean');
      assert.ok(Array.isArray(entry.languages));
    }
  });

  it('checkRequired filters to the requested linters', () => {
    const report = toolchain.checkRequired(process.cwd(), ['eslint']);
    assert.deepStrictEqual(report.map((t) => t.linter), ['eslint']);
  });
});
