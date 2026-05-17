# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  alongside ESLint (JS/TS) and Ruff (Python).
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
