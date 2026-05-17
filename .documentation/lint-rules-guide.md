# Lint Rules Guide

gimme-the-lint ships a **best-practice baseline configuration for every
supported codebase**. `gimme-the-lint install` seeds each discovered app with
its linter's config — **create-if-absent**, so an existing config you wrote is
never overwritten (use `--force` to replace).

The shipped rule sets are the **recommended / curated tier**: each linter's
recommended rules plus a hand-picked set of high-value extras, tuned for low
false-positive noise. Because gimme-the-lint is progressive, even a strict rule
never blocks existing code — it is baselined; only *new* violations block.

## Supported codebases

| Codebase | Linter | Config file (seeded by `install`) | Bound by |
|----------|--------|-----------------------------------|----------|
| JavaScript / TypeScript | ESLint | `eslint.config.js` + `.prettierrc.json` | `package.json` |
| JavaScript / TypeScript | Biome | `biome.json` | `biome.json` (supersedes ESLint) |
| Python | Ruff | `pyproject.toml` (`[tool.ruff]`) | `pyproject.toml` / `requirements.txt` / `setup.py` |
| Go | golangci-lint | `.golangci.yml` | `go.mod` |
| Rust | Clippy | `clippy.toml` + `Cargo.toml` `[lints.clippy]` | `Cargo.toml` |
| Terraform / OpenTofu | TFLint | `.tflint.hcl` | `*.tf` / `*.tofu` files |

The config is written **into the app directory**, not the repo root — each app
in a monorepo gets its own. Edit that file to adjust rules for that app.

> **Detection-key nuance:** Biome and Ruff are *detected by* their config file
> (`biome.json`, `pyproject.toml`). An already-discovered app therefore already
> has one, so `install` reports it as `exists`. The shipped template still
> applies when you adopt the linter fresh or run `install --force`.

## Two security layers

Security linting is layered. **Secret detection is cross-cutting** — a
hardcoded password or SSL key in a `.tf`, `.env`, or `.yaml` file belongs to no
single language — so it is handled once, universally, by **gitleaks**. The
per-linter security rules add language-specific depth on top.

| Layer | Tool | Covers | Gating |
|-------|------|--------|--------|
| Universal | **gitleaks** | hardcoded passwords, API tokens, SSL/private keys, high-entropy strings — every file, every language | **Always blocks** — secrets are never baselined |
| JS/TS | `eslint-plugin-security` + `eslint-plugin-no-secrets` | unsafe APIs, `eval`, entropy strings | Progressive (baselined) |
| JS/TS | Biome `security` group | `eval`, XSS sinks | Progressive |
| Python | Ruff `S` (flake8-bandit) | hardcoded passwords, SQL injection, SSL misuse | Progressive |
| Go | `gosec` | `G101` credentials, injection, weak crypto, insecure TLS | Progressive |

A leaked credential is never grandfathered: gitleaks runs as a pre-commit gate
and fails on **any** finding. The per-linter security rules follow normal
progressive baselining like every other rule.

---

## JavaScript / TypeScript — ESLint

**Config:** `eslint.config.js` (ESLint v9 flat config) + `.prettierrc.json`.

**Baseline rules:**
- `@eslint/js` recommended, React / React Hooks / React Refresh recommended sets
- Architecture guards — `import/no-restricted-paths` (zone-based upward-import
  bans), `import/no-cycle`, `import/no-self-import`
- `no-unused-vars` with the `^_` ignore pattern; `@typescript-eslint/no-explicit-any`
- **Security** — `eslint-plugin-security` recommended rules + `eslint-plugin-no-secrets`
- **Prettier-compatible** — `eslint-config-prettier` is applied last to disable
  stylistic rules that would conflict with Prettier

**Required dev dependencies** (install in the target project):
```bash
npm install --save-dev eslint @eslint/js globals \
  eslint-plugin-react eslint-plugin-react-hooks eslint-plugin-react-refresh \
  eslint-plugin-import @typescript-eslint/eslint-plugin @typescript-eslint/parser \
  eslint-plugin-security eslint-plugin-no-secrets eslint-config-prettier prettier
```

**How to adjust:** edit `eslint.config.js`. Rules live in the `rules:` block of
the JS and TS config objects. The `import/no-restricted-paths` `zones` array is
a placeholder — point it at your project's real directory structure. Formatting
is owned by Prettier — edit `.prettierrc.json` for that.

---

## JavaScript / TypeScript — Biome

**Config:** `biome.json`. Used instead of ESLint when an app has a `biome.json`.

**Baseline rules:**
- `recommended: true` — Biome's recommended set across all groups
- Extras: `noUnresolvedImports`, `noConsole` (allows `error`/`warn`/`info`),
  `noImportCycles`, `noExcessiveCognitiveComplexity` (threshold 15)
- **Security group fully enabled** — `noGlobalEval`, `noDangerouslySetInnerHtml`
  (+ `WithChildren`), `noBlankTarget`, `noSecrets`
- Formatter enabled (2-space, 100 columns, double quotes)
- Test files relax `noConsole` / `noImportCycles` via an `overrides` entry

**How to adjust:** edit `biome.json`. Rule levels (`off` / `warn` / `error`)
live under `linter.rules.<group>`. Formatter options are under `formatter` and
`javascript.formatter`. Biome has no genuine secret scanner — `noSecrets` is a
thin heuristic; gitleaks remains the real secret layer.

---

## Python — Ruff

**Config:** `pyproject.toml`, `[tool.ruff]` tables.

**Baseline rules** (`[tool.ruff.lint]` `select`):
- `E` / `W` pycodestyle, `F` pyflakes, `I` isort, `B` flake8-bugbear, `UP` pyupgrade
- **`S` flake8-bandit — security** (hardcoded passwords `S105-107`, SQL
  injection, SSL/TLS misuse)
- `C4` comprehensions, `SIM` simplify, `RUF` Ruff-specific rules
- `per-file-ignores` exempts tests from `S101` (assert) / `S105` / `S106`

**How to adjust:** edit `pyproject.toml`. Add/remove rule codes in
`[tool.ruff.lint]` `select` / `ignore`. The Ruff formatter (`[tool.ruff.format]`)
replaces Black. If the app already had a `pyproject.toml`, `install` does not
overwrite it — copy the `[tool.ruff*]` tables from
`templates/pyproject.template.toml` in the gimme-the-lint package.

---

## Go — golangci-lint

**Config:** `.golangci.yml` — **golangci-lint v2 format** (`version: "2"`).

**Baseline rules:**
- `default: standard` — `errcheck`, `govet`, `ineffassign`, `staticcheck`, `unused`
- Correctness extras — `bodyclose`, `errorlint`, `nilerr`, `noctx`,
  `durationcheck`, `makezero`, `copyloopvar`
- **Security — `gosec`** (hardcoded credentials, injection, weak crypto,
  insecure TLS); `G104`/`G115` excluded as noisy/redundant
- Quality — `revive`, `gocritic`, `gocyclo`, `misspell`, `unparam`, and more
- `formatters` block runs `goimports` + `gofumpt`
- Test files (`_test.go`) are scoped out of `gosec`/`errcheck`/`bodyclose`

**How to adjust:** edit `.golangci.yml`. Add/remove linters under
`linters.enable`; tune them under `linters.settings`; scope exclusions under
`linters.exclusions`. Set `formatters.settings.goimports.local-prefixes` to your
module path (commented placeholder in the template).

---

## Rust — Clippy

Clippy needs **two files** — `clippy.toml` tunes thresholds, but lint *groups*
can only be enabled in `Cargo.toml`'s `[lints.clippy]` table (Cargo 1.74+).

**Config:**
- `clippy.toml` — threshold tuning (cognitive complexity 15, too-many-args 6,
  unwrap/expect allowed in tests, `msrv`)
- `Cargo.toml` `[lints.clippy]` — **appended by `install` only if `Cargo.toml`
  has no `[lints]` table.** Enables `pedantic` + `cargo` at `warn`, with noisy
  pedantic lints (`module_name_repetitions`, `must_use_candidate`, …) allowed back

**How to adjust:**
- Lint *levels / groups* → edit `[lints.clippy]` in `Cargo.toml`. For a
  workspace, move it to `[workspace.lints.clippy]` in the root `Cargo.toml` and
  add `[lints]` `workspace = true` to each member crate.
- Lint *thresholds* → edit `clippy.toml`.
- Clippy has no secret/credential lints — gitleaks covers Rust files.

If `Cargo.toml` already had a `[lints]` table, `install` leaves it alone — copy
the block from `templates/clippy-cargo-lints.template.toml` in the package.

---

## Terraform / OpenTofu — TFLint

**Config:** `.tflint.hcl`.

**Baseline rules:**
- Bundled `terraform` ruleset, `preset = "recommended"` — deprecated syntax,
  unused declarations, pinned module sources, required versions, typed variables
- Works **fully offline** — no `tflint --init`, no network

**How to adjust:** edit `.tflint.hcl`.
- Stricter: change `preset` to `"all"` (adds naming conventions, documented
  variables/outputs, standard module structure).
- Cloud-provider security checks (AWS/GCP/Azure best practices) need a provider
  plugin block plus `tflint --init` — see the commented examples in the file.
  **Do not** add provider plugins for air-gapped installs.
- TFLint is not a security scanner; gitleaks covers secrets in `.tf` files.
  Deeper IaC security scanning (open security groups, unencrypted storage) is a
  job for `tfsec` / `trivy`, which gimme-the-lint does not yet wrap.

---

## Secrets — gitleaks (all codebases)

**Config:** `.gitleaks.toml` at the repo root, written by `install`.

Extends gitleaks' default ruleset and adds detection for Anthropic / OpenAI /
Google / AWS keys, JWT secrets, database URLs with embedded passwords, PEM
private keys / SSL cert keys, and generic hardcoded password assignments. An
allowlist suppresses obvious test/example placeholders.

gitleaks runs via the pre-commit hook (`.pre-commit-config.yaml`) and **fails on
any finding** — secrets are never baselined. To tune false positives, edit the
`[allowlist]` section of `.gitleaks.toml`.

---

## Changing the strictness tier

The shipped configs are the **recommended tier**. To go stricter, edit the
relevant config directly — each section above notes the stricter knob (Biome:
escalate `warn`→`error` and enable `nursery`; golangci-lint: add linters; Ruff:
add rule codes; Clippy: `pedantic`/`cargo` at `deny` + `nursery`; TFLint:
`preset = "all"`). Because violations are progressively baselined, raising
strictness never blocks existing code — only new code is held to the higher bar.
