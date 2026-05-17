# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-05-17

### Added
- **Ansible support** via a new `ansible-lint` adapter. ansible-lint plugs into
  the progressive-lint engine like every other linter: it runs
  `ansible-lint -f codeclimate`, parses the CodeClimate JSON report, and only
  new violations block. Supports `--fix`.
- **Manifest-based discovery** for Ansible: a directory containing `ansible.cfg`
  or `galaxy.yml` is auto-discovered and bound to `ansible-lint`. Ansible
  playbooks are plain YAML with no manifest, so detection keys off those
  unambiguous markers rather than a file extension (a YAML scan would match
  nearly every repo). An Ansible repo with neither marker needs an explicit
  `apps` entry in `gimme-the-lint.config.js`.
- **Ansible best-practice config** — `install` seeds `.ansible-lint` with the
  `moderate` profile (the strictness lever; raise to `safety` / `production`).
- README now documents every supported codebase with a default-rules summary
  and the strictness lever for each; `.documentation/lint-rules-guide.md` adds
  a full Ansible section.

## [2.1.0] - 2026-05-17

### Added
- **Terraform / OpenTofu support** via a new `tflint` linter adapter. tflint
  plugs into the same progressive-lint engine as every other linter: baselines
  are captured into `.gtl/apps/<app>/baseline.json` under a `tflint` section,
  fingerprinted by `file + rule + message`, and only new violations block.
  - Runs `tflint --format=json`, module-scoped (executes inside the module
    directory for compatibility with tflint versions predating `--chdir`).
  - Parses both `issues` and `errors` — broken HCL surfaces as a blocking
    error rather than slipping through as zero issues.
  - Supports `--fix`; tracks config drift on `.tflint.hcl`.
- **Extension-based app discovery** for Terraform: a directory containing
  `*.tf` / `*.tofu` source is auto-discovered and bound to `tflint`. Terraform
  has no manifest file, so it is discovered by extension rather than by a
  manifest like `package.json` or `go.mod`. In the root-module layout (`.tf`
  at the repo root *and* in `modules/*/`), the root is treated as a workspace
  root — bind `.` explicitly in `gimme-the-lint.config.js` to lint it. See the
  installation guide.
- **Best-practice config templates** for every supported codebase. `install`
  now seeds each discovered app with a curated, "recommended tier" config for
  its linter — `eslint.config.js` + `.prettierrc.json`, `biome.json`,
  `pyproject.toml` `[tool.ruff]`, `.golangci.yml` (golangci-lint v2 format),
  `clippy.toml` + `Cargo.toml` `[lints.clippy]`, `.tflint.hcl`. Every write is
  create-if-absent — an existing config is never overwritten (`--force`
  replaces). New module `lib/linter-configs.js`.
- **Security lint rules** across every codebase. gitleaks remains the universal
  secret scanner (passwords, SSL/private keys, tokens — always blocks, never
  baselined) and its template now also flags PEM private keys and hardcoded
  password assignments. Per-linter security layers are enabled in the shipped
  configs: `gosec` (Go), Ruff `S` / flake8-bandit (Python),
  `eslint-plugin-security` + `eslint-plugin-no-secrets` (JS/TS), and Biome's
  `security` rule group.
- **Prettier support** — a `.prettierrc.json` template is seeded for ESLint
  apps, and the ESLint config now applies `eslint-config-prettier` so the two
  do not fight over formatting. The ESLint template refresh is additive: every
  pre-existing rule (architecture import guards, `no-cycle`, unused-vars) is
  retained.
- **New documentation** — `.documentation/lint-rules-guide.md` documents every
  supported codebase, its baseline rules, the security layers, and how/where to
  adjust them.

## [2.0.0] - 2026-05-17

A ground-up rearchitecture: gimme-the-lint is now a language-agnostic
progressive-lint engine that owns its own baseline diffing, driven by
per-directory linter adapters.

### Breaking Changes
- **Baseline layout moved** from `frontend/.lttf/` + `backend/.lttf-ruff/` to a
  single per-app tree, `.gtl/apps/<app>/baseline.json`, plus a global
  `.gtl/manifest.json`. Run `gimme-the-lint migrate` to convert (it backs up
  the legacy directories and re-baselines).
- **Baseline file format changed** to a linter-agnostic fingerprint map.
- **Config schema changed**: the `frontend`/`backend` model is replaced by an
  optional `apps` map binding directories to linters; `skipPatterns` added.
  `lttfDir`/`ruffBaselineDir` keys removed.
- **`check` flags removed**: `--frontend-only`, `--backend-only`, `--verbose`.
- **GitHub Action inputs changed**: `frontend`/`backend` removed (linting is
  now polyglot auto-detect); `strict` added. Pin `@v2`.
- The `lint-to-the-future` dependency is gone — gimme-the-lint no longer shells
  out to it; ESLint progressivity is handled by the in-house engine.

### Added
- In-house progressive-diff engine: line/column-independent violation
  fingerprints, so baselined violations survive code shifting in a file.
- Linter adapter interface — each linter is a self-contained adapter.
- **Go** support via `golangci-lint` and **Rust** support via `cargo clippy`,
  alongside ESLint and **Biome** (JS/TS) and Ruff (Python).
- **Biome** adapter: a `biome.json` binds an app to Biome and supersedes the
  default ESLint binding for that app.
- Polyglot project model: apps auto-discovered by walking for package
  manifests; monorepo workspaces handled; `_template-*` dirs skipped.
- Per-app drift detection (app add/remove, config, linter version, age) —
  a change in one app never churns unrelated baselines.
- Idempotent skips: an app with code but no installed linter is warn-skipped
  (never blocks), or fails loudly under `--strict`.
- `--offline` install for air-gapped environments (no npm/pip fetches; fails
  loudly on a missing toolchain).
- `--no-baseline` greenfield install / `baseline --empty` — "strict from day
  one" with nothing grandfathered.
- `gimme-the-lint migrate` — one-shot v1 → v2 migration.

### Changed
- `run-checks.sh`, `eslint-baseline.sh`, `ruff-baseline.sh`, `dashboard.sh` are
  now thin shims over the Node engine.
- The dashboard renders from `.gtl/manifest.json` with per-app drift.

## [1.1.2] - 2026-04-11

### Fixed
- Plugin manifest now passes `claude plugin validate`. Rewrote `.claude-plugin/plugin.json` to the minimal schema Claude Code actually accepts (dropped `displayName`, `claudeCodeVersion`, `type`, `commands`, `agents`, `hooks` — all of those were either unsupported keys or wrongly-shaped arrays that the validator rejected).
- Moved command definitions from `.claude-plugin/commands/*.md` → `commands/*.md` at the repo root (Claude Code's auto-discovery convention).
- Added YAML frontmatter (`description` field) to all three command files and to `agents/linting-agent.md`.

### Added
- `.claude-plugin/marketplace.json` — registers gimme-the-lint as a standalone Claude Code marketplace, so users can install with `claude plugin install gimme-the-lint@gimme-the-lint-marketplace`.
- `commands/` added to npm `files` array so the plugin's slash commands actually ship in the tarball.

## [1.1.1] - 2026-03-19

### Fixed
- ESM project support: `initConfig()` now writes `gimme-the-lint.config.cjs` when the target project has `"type": "module"` in package.json
- `getConfig()` checks for `.cjs` first, then falls back to `.js`
- All shell scripts and `action.yml` use two-step config lookup (`.cjs` then `.js`)

## [1.1.0] - 2026-03-19

### Added
- Shell scripts now read `gimme-the-lint.config.js` for directory paths (`frontendDir`, `backendDir`, `srcDir`, `appDir`)
- Config-driven directory detection in `run-checks.sh`, `eslint-baseline.sh`, `ruff-baseline.sh`, `dashboard.sh`, and `action.yml` inline fallback
- Backward-compatible: if no config file exists, auto-detection falls through to existing logic

## [1.0.1] - 2026-02-03

### Changed
- Updated Python minimum version from 3.8 to 3.11
- Updated GitHub Action defaults: Node.js 20 → 22, Python 3.11 → 3.13
- Updated Python dependency floors: ruff >=0.9.0, mypy >=1.15.0, pytest >=9.0.0, pytest-asyncio >=1.0.0, pytest-cov >=7.0.0

### Added
- Documentation guides in `.documentation/`: installation, when-to-use, how-to-use, troubleshooting

## [1.0.0] - 2026-02-03

### Added
- Progressive linting system for monorepo projects (Python + JS/TS)
- Directory-chunked auto-discovery of production directories
- Per-directory baselines (ESLint for frontend, Ruff for backend)
- Manifest-based drift detection (directory, config, time, violation drift)
- Auto-healing: manifests update automatically on re-baseline
- Python .venv auto-creation with ruff, mypy installation
- Git hooks (pre-commit for changed files, pre-push for full lint)
- GitHub Action (`action.yml`) for CI/CD integration with PR comments
- Workflow template for easy adoption
- Claude Code plugin integration with /lint, /lint:status, /lint:baseline commands
- CLI tool with install, check, baseline, dashboard, hooks, venv, status commands
- Configuration templates: ESLint v9 flat config, pyproject.toml (Ruff), gitleaks, commitlint, pre-commit
- Auto-fix support via `--fix` flag
- LLM-optimized pre-commit output (instructs Claude Code to auto-fix without asking)
