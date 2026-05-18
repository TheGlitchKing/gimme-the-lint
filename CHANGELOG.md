# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.0] - 2026-05-17

### Added
- **`.gtl/config.js` — consolidated config location.** gimme-the-lint's own
  config file now lives canonically at `.gtl/config.js` (`.gtl/config.cjs` for
  ESM projects), so it travels with the committed `.gtl/` baselines rather than
  sitting loose at the repo root. `install` and `migrate` write new configs
  there; `config-manager.findConfig()` resolves the location. A repo-root
  `gimme-the-lint.config.js` is still read as a fallback — existing projects
  need no change — and `.gtl/` wins when both exist. `uninstall` removes a
  repo-root config but leaves a `.gtl/` one in place (it is part of the
  preserved `.gtl/` directory). Linter configs (`eslint.config.js`,
  `.tflint.hcl`, …) are unaffected: each linter resolves its own config from a
  fixed location gimme-the-lint does not own.

## [2.4.0] - 2026-05-17

### Fixed
- **tflint silent-failure on uninitialized ruleset plugins.** When a unit
  carries a `.tflint.hcl`, tflint requires `tflint --init` before linting; the
  adapter never ran it, so a failed run was recorded as a clean zero-violation
  baseline that mis-gated every later commit. Adapters gain an `initCommand()`
  hook (run once per directory); the tflint adapter runs `tflint --init` when a
  `.tflint.hcl` is present. `parse()` now takes `(stdout, stderr, code)` — a
  non-zero exit with no parseable JSON emits a high-severity `tflint-error`
  violation, never a silent clean pass.
- **eslint false-positive on a tooling-only `package.json`.** Discovery bound
  eslint on the filename alone, so a devDependencies-only, source-free
  `package.json` (one that merely pins a tooling dependency) became an eslint
  app. `package.json` is now a conditional marker — eslint is bound only when
  the directory looks like a real JS app (runtime deps / entry-point fields /
  JS-TS source / an eslint or biome config). `EslintAdapter.detect()` is
  likewise tightened so a bare `package.json` is insufficient.
- **tflint `available()` over-reporting.** It returned true even when ruleset
  plugins a `.tflint.hcl` declared were not installed, disagreeing with
  `lint()`. It now verifies every declared plugin resolves.
- **`.terraform.lock.hcl` removed from the tflint manifest files** — it is a
  provider-lock file written by `terraform init`, not a tflint signal.

### Added
- **Generic ruleset-plugin version tracking.** `TflintAdapter.rulesetVersions()`
  parses `tflint --version` into a `{ ruleset: version }` map — no ruleset name
  is special-cased. A new `ruleset_versions` field is threaded through
  baselines and the global manifest; drift detection emits a `ruleset` drift
  entry when a plugin version changes, catching a plugin update under a loose
  `.tflint.hcl` version constraint that left `config_hash` and `tool_version`
  untouched.
- **Rule rename/removal migration.** Per-linter rule-alias maps
  (`lib/rule-aliases.js`) plus `gimme-the-lint migrate --rules`: re-lints each
  unit and rewrites a renamed rule's baseline fingerprint old→new (preserving
  the grandfather count), drops entries for rules that no longer occur, and
  corrects `total`. A genuinely new violation is never grandfathered.

### Changed
- **`tflint.parse()` signature** is now `(stdout, stderr, code)`, matching the
  base adapter contract.
- **Removed the dead v1 drift path.** `lib/drift-detector.js` (superseded by
  `lib/drift.js`) is deleted; `lib/manifest-manager.js` is slimmed to its one
  live function, `hashFile()` — the v2 global manifest is owned by
  `lib/gtl-manifest.js`.

### Design
- The tflint adapter never names a cloud provider. The bundled `terraform`
  ruleset lints any Terraform repo with zero config; provider-specific rulesets
  are opt-in and owned entirely by the target repo's own `.tflint.hcl`, which
  the adapter parses generically for whatever `plugin` blocks it declares.

## [2.3.0] - 2026-05-17

### Fixed
- **Bug A — monorepo linter binary resolution.** The ESLint and Biome adapters
  resolved `node_modules/.bin/<linter>` only at the repo root, so in a monorepo
  (where each JS app carries its own `node_modules`) `available()` returned
  false and the linter was silently skipped — capturing an empty baseline.
  Adapters now resolve the binary app-dir-first (app → repo root → PATH) and
  run inside the app directory so the app's own flat config is discovered. The
  Ruff adapter resolves its `.venv` the same way.
- **Bug B — discovery bound the wrong directories.** Manifest discovery treated
  a bare `requirements.txt` as a ruff app marker (binding nested load-test and
  utility dirs) and discarded a repo-root config whenever any nested manifest
  existed (leaving the real app unbound). `requirements.txt` is no longer a
  discovery marker — `pyproject.toml`, `ruff.toml`, `.ruff.toml` and `setup.py`
  are — and workspace-root detection is now **per linter**, so a repo-root
  `[tool.ruff]` config binds the root even when nested `package.json` apps sit
  below it.
- **Bug C — "couldn't run" collapsed into "skipped".** An unavailable or
  errored linter was recorded with the status used for "no code here", making
  an incomplete baseline indistinguishable from a clean one — every
  pre-existing violation later counted as new and blocked the commit. New
  baseline statuses `unavailable` and `error` keep incomplete baselines
  distinct; `migrate` and `baseline` print a prominent summary and exit
  non-zero (override with `--allow-incomplete`); `hooks` refuses to install
  against an incomplete baseline (override with `--force`); `check` reports
  `needs-baseline` instead of flooding new violations.

### Added
- `migrate` now writes the discovered app/linter layout into
  `gimme-the-lint.config.js` as an explicit `apps` map, so the guess is visible
  and editable instead of silently re-derived on every run. It also emits a
  warning when the layout is ambiguous (a repo-root config plus nested apps).

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
