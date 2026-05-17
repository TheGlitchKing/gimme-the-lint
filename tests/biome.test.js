'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const adapters = require('../lib/adapters');
const BiomeAdapter = require('../lib/adapters/biome');
const projectModel = require('../lib/project-model');

describe('Biome adapter', () => {
  it('is registered and handles JS/TS', () => {
    assert.ok(adapters.hasAdapter('biome'));
    assert.ok(adapters.getAdapter('biome') instanceof BiomeAdapter);
    const js = adapters.adaptersForLanguage('javascript').map((a) => a.id);
    assert.ok(js.includes('biome'));
  });

  describe('parse', () => {
    const biome = new BiomeAdapter({ projectRoot: '/proj' });

    it('parses biome --reporter=json diagnostics', () => {
      const json = JSON.stringify({
        summary: { errors: 1, warnings: 1 },
        diagnostics: [
          {
            category: 'lint/suspicious/noDoubleEquals',
            severity: 'error',
            description: 'Use === instead of ==.',
            location: { path: { file: 'src/a.ts' }, span: [10, 12] },
          },
          {
            category: 'lint/style/useConst',
            severity: 'warning',
            description: 'This let declares a variable that is never reassigned.',
            location: { path: { file: 'src/b.ts' }, span: [4, 9] },
          },
        ],
      });
      const violations = biome.parse(json);
      assert.strictEqual(violations.length, 2);
      assert.strictEqual(violations[0].file, 'src/a.ts');
      assert.strictEqual(violations[0].ruleId, 'lint/suspicious/noDoubleEquals');
      assert.strictEqual(violations[0].severity, 'error');
      assert.strictEqual(violations[0].source, 'biome');
      assert.strictEqual(violations[1].severity, 'warning');
    });

    it('falls back to message fragments when description is absent', () => {
      const json = JSON.stringify({
        diagnostics: [
          {
            category: 'lint/x',
            severity: 'error',
            message: [{ content: 'frag one ' }, { content: 'frag two' }],
            location: { path: { file: 'a.js' } },
          },
        ],
      });
      assert.strictEqual(biome.parse(json)[0].message, 'frag one frag two');
    });

    it('returns [] for empty or non-JSON output', () => {
      assert.deepStrictEqual(biome.parse(''), []);
      assert.deepStrictEqual(biome.parse('not json'), []);
    });
  });

  describe('project-model integration', () => {
    const TMP = path.join(os.tmpdir(), `gimme-test-biome-${Date.now()}`);

    before(async () => {
      await fs.ensureDir(TMP);
      // An app configured for Biome — package.json AND biome.json present.
      await fs.writeFile(path.join(TMP, 'package.json'), '{}');
      await fs.writeFile(path.join(TMP, 'biome.json'), '{}');
    });
    after(async () => {
      await fs.remove(TMP);
    });

    it('binds a biome.json app to Biome and drops the default ESLint', () => {
      const apps = projectModel.discoverApps(TMP);
      assert.strictEqual(apps.length, 1);
      assert.deepStrictEqual(apps[0].linters, ['biome']);
    });
  });
});
