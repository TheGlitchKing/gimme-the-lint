'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const linterConfigs = require('../lib/linter-configs');
const configManager = require('../lib/config-manager');

const TEMPLATES = configManager.TEMPLATES_DIR;

describe('shipped config templates', () => {
  it('every linter in LINTER_CONFIGS has a template file on disk', () => {
    for (const [linter, spec] of Object.entries(linterConfigs.LINTER_CONFIGS)) {
      assert.ok(
        fs.existsSync(path.join(TEMPLATES, spec.template)),
        `missing template for ${linter}: ${spec.template}`
      );
    }
  });

  it('biome template is valid JSON and enables the security group', () => {
    const biome = JSON.parse(
      fs.readFileSync(path.join(TEMPLATES, 'biome.template.json'), 'utf8')
    );
    const security = biome.linter.rules.security;
    assert.ok(security.noGlobalEval, 'noGlobalEval security rule present');
    assert.ok(security.noDangerouslySetInnerHtml, 'XSS-sink rule present');
    assert.strictEqual(biome.linter.rules.recommended, true);
  });

  it('prettier template is valid JSON', () => {
    const prettier = JSON.parse(
      fs.readFileSync(path.join(TEMPLATES, '.prettierrc.template.json'), 'utf8')
    );
    assert.strictEqual(prettier.printWidth, 100);
    assert.strictEqual(prettier.endOfLine, 'lf');
  });

  it('ruff template selects the flake8-bandit security rules', () => {
    const ruff = fs.readFileSync(path.join(TEMPLATES, 'pyproject.template.toml'), 'utf8');
    assert.match(ruff, /"S",\s*#.*security/, 'ruff select includes "S" (bandit)');
    assert.match(ruff, /per-file-ignores/, 'tests are exempted from S101/S105/S106');
  });

  it('eslint template adds security plugins and Prettier compatibility', () => {
    const eslint = fs.readFileSync(
      path.join(TEMPLATES, 'eslint.config.template.js'),
      'utf8'
    );
    assert.match(eslint, /eslint-plugin-security/);
    assert.match(eslint, /eslint-plugin-no-secrets/);
    assert.match(eslint, /eslint-config-prettier/);
    // Non-regression: the original architecture rules must still be present.
    assert.match(eslint, /import\/no-restricted-paths/);
    assert.match(eslint, /import\/no-cycle/);
    assert.match(eslint, /import\/no-self-import/);
    assert.match(eslint, /argsIgnorePattern: '\^_'/);
  });

  it('golangci template is v2 format and enables gosec', () => {
    const golangci = fs.readFileSync(path.join(TEMPLATES, '.golangci.template.yml'), 'utf8');
    assert.match(golangci, /version:\s*"2"/);
    assert.match(golangci, /-\s*gosec/);
  });

  it('tflint template uses the bundled terraform ruleset', () => {
    const tflint = fs.readFileSync(path.join(TEMPLATES, '.tflint.template.hcl'), 'utf8');
    assert.match(tflint, /plugin "terraform"/);
    assert.match(tflint, /preset\s*=\s*"recommended"/);
  });

  it('gitleaks template detects private keys and hardcoded passwords', () => {
    const gitleaks = fs.readFileSync(path.join(TEMPLATES, '.gitleaks.template.toml'), 'utf8');
    assert.match(gitleaks, /private-key-pem/);
    assert.match(gitleaks, /hardcoded-password/);
  });
});

describe('writeConfig — create-if-absent', () => {
  const TMP = path.join(os.tmpdir(), `gimme-test-lc-write-${Date.now()}`);

  before(async () => {
    await fs.ensureDir(TMP);
  });
  after(async () => {
    await fs.remove(TMP);
  });

  it('creates a config when absent and substitutes template vars', async () => {
    const res = await linterConfigs.writeConfig(TMP, 'eslint');
    assert.strictEqual(res.status, 'created');
    const written = await fs.readFile(path.join(TMP, 'eslint.config.js'), 'utf8');
    assert.ok(!written.includes('{{REACT_VERSION}}'), 'template var substituted');
  });

  it('does not overwrite an existing config', async () => {
    await fs.writeFile(path.join(TMP, 'biome.json'), '{"custom":true}');
    const res = await linterConfigs.writeConfig(TMP, 'biome');
    assert.strictEqual(res.status, 'exists');
    const kept = await fs.readFile(path.join(TMP, 'biome.json'), 'utf8');
    assert.strictEqual(kept, '{"custom":true}', 'user config left untouched');
  });

  it('overwrites when force is set', async () => {
    const res = await linterConfigs.writeConfig(TMP, 'biome', { force: true });
    assert.strictEqual(res.status, 'created');
  });

  it('skips an unknown linter id', async () => {
    const res = await linterConfigs.writeConfig(TMP, 'nope');
    assert.strictEqual(res.status, 'skipped');
  });
});

describe('writeClippyLints — Cargo.toml [lints.clippy]', () => {
  const TMP = path.join(os.tmpdir(), `gimme-test-lc-clippy-${Date.now()}`);

  before(async () => {
    await fs.ensureDir(TMP);
  });
  after(async () => {
    await fs.remove(TMP);
  });

  it('appends [lints.clippy] when Cargo.toml has no [lints] table', async () => {
    const dir = path.join(TMP, 'crate-a');
    await fs.ensureDir(dir);
    await fs.writeFile(path.join(dir, 'Cargo.toml'), '[package]\nname = "a"\n');
    const res = await linterConfigs.writeClippyLints(dir);
    assert.strictEqual(res.status, 'appended');
    const cargo = await fs.readFile(path.join(dir, 'Cargo.toml'), 'utf8');
    assert.match(cargo, /\[lints\.clippy\]/);
    assert.match(cargo, /pedantic/);
  });

  it('leaves Cargo.toml alone when a [lints] table already exists', async () => {
    const dir = path.join(TMP, 'crate-b');
    await fs.ensureDir(dir);
    await fs.writeFile(path.join(dir, 'Cargo.toml'), '[package]\nname = "b"\n\n[lints.clippy]\n');
    const res = await linterConfigs.writeClippyLints(dir);
    assert.strictEqual(res.status, 'exists');
  });

  it('skips when there is no Cargo.toml', async () => {
    const dir = path.join(TMP, 'crate-c');
    await fs.ensureDir(dir);
    const res = await linterConfigs.writeClippyLints(dir);
    assert.strictEqual(res.status, 'skipped');
  });
});

describe('writeLinterConfigs — polyglot project', () => {
  const TMP = path.join(os.tmpdir(), `gimme-test-lc-poly-${Date.now()}`);

  before(async () => {
    await fs.ensureDir(TMP);
    // JS app — eslint (also gets Prettier).
    await fs.ensureDir(path.join(TMP, 'apps/web'));
    await fs.writeFile(path.join(TMP, 'apps/web/package.json'), '{"name":"web","dependencies":{}}');
    // Go app — golangci-lint.
    await fs.ensureDir(path.join(TMP, 'apps/api'));
    await fs.writeFile(path.join(TMP, 'apps/api/go.mod'), 'module api\n');
    // Rust app — clippy (also gets Cargo.toml [lints]).
    await fs.ensureDir(path.join(TMP, 'apps/engine'));
    await fs.writeFile(path.join(TMP, 'apps/engine/Cargo.toml'), '[package]\nname = "engine"\n');
    // Terraform app — tflint.
    await fs.ensureDir(path.join(TMP, 'infra'));
    await fs.writeFile(path.join(TMP, 'infra/main.tf'), 'resource "x" "y" {}\n');
  });
  after(async () => {
    await fs.remove(TMP);
  });

  it('seeds the right config into every discovered app', async () => {
    const written = await linterConfigs.writeLinterConfigs(TMP);
    const created = written.filter(
      (w) => w.status === 'created' || w.status === 'appended'
    );
    const files = created.map((w) => `${w.app}:${w.file}`);

    assert.ok(files.includes('apps/web:eslint.config.js'), 'eslint config seeded');
    assert.ok(files.includes('apps/web:.prettierrc.json'), 'prettier config seeded for JS app');
    assert.ok(files.includes('apps/api:.golangci.yml'), 'golangci config seeded');
    assert.ok(files.includes('apps/engine:clippy.toml'), 'clippy.toml seeded');
    assert.ok(
      files.includes('apps/engine:Cargo.toml [lints.clippy]'),
      'Cargo.toml lints appended'
    );
    assert.ok(files.includes('infra:.tflint.hcl'), 'tflint config seeded');

    // Files actually exist on disk.
    assert.ok(await fs.pathExists(path.join(TMP, 'apps/web/eslint.config.js')));
    assert.ok(await fs.pathExists(path.join(TMP, 'apps/api/.golangci.yml')));
    assert.ok(await fs.pathExists(path.join(TMP, 'infra/.tflint.hcl')));
  });

  it('is idempotent — a second run creates nothing', async () => {
    const written = await linterConfigs.writeLinterConfigs(TMP);
    const created = written.filter(
      (w) => w.status === 'created' || w.status === 'appended'
    );
    assert.strictEqual(created.length, 0, 'second run is a no-op');
  });
});
