# gimme-the-lint

[![npm version](https://img.shields.io/npm/v/@theglitchking/gimme-the-lint.svg)](https://www.npmjs.com/package/@theglitchking/gimme-the-lint)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Action](https://github.com/TheGlitchKing/gimme-the-lint/workflows/Progressive%20Lint/badge.svg)](https://github.com/TheGlitchKing/gimme-the-lint/actions)

---

## Summary

Most code projects use linters to catch mistakes and keep code clean. The problem is that when you add a linter to a project that already has a lot of code, the linter finds hundreds or even thousands of old problems. This makes it impossible to turn on linting without fixing everything first, so teams just never do it. **gimme-the-lint** solves this by remembering all the old problems and only blocking your work when you create a _new_ problem. Over time, your team can clean up the old stuff at its own pace while making sure no new messes get added.

---

## Operational Summary

gimme-the-lint works by creating "baselines" — snapshots of every existing lint violation in your project, organized by directory. When you make a commit, it compares the current violations against the baseline. If the only violations it finds are ones that were already there before, the commit goes through. If you introduced something new, the commit is blocked and you're told exactly what to fix.

Under the hood, the plugin auto-discovers your project's production directories (skipping test folders), generates per-directory baseline files using ESLint (for JavaScript/TypeScript) and Ruff (for Python), and stores a manifest file with an MD5 hash of your linter config. On every run it checks for "drift" — whether directories were added or removed, whether config files changed, or whether baselines are getting stale. When drift is found, it warns you and can auto-heal itself the next time you refresh baselines. The entire system runs through git hooks (pre-commit and pre-push), a CLI, a GitHub Action, or Claude Code slash commands.

---

## Features

- **Progressive Linting** — Only new violations block commits; old ones are baselined and tracked
- **Directory-Chunked Auto-Discovery** — Automatically finds production directories; no config needed
- **Manifest-Based Drift Detection** — Catches directory drift, config drift, time drift, and violation drift
- **Auto-Healing** — Manifests self-update when you re-run baselines
- **Python .venv Management** — Auto-creates a virtual environment with ruff and mypy
- **Git Hooks** — Pre-commit checks changed files (~30s), pre-push checks everything
- **GitHub Action** — CI/CD integration that posts results as PR comments
- **Claude Code Plugin** — `/lint`, `/lint:status`, `/lint:baseline` slash commands
- **LLM-Optimized Output** — Pre-commit failures include instructions that tell Claude Code to auto-fix without asking
- **Monorepo Support** — Works with Python backends, JS/TS frontends, or both together
- **Auto-Fix** — Pass `--fix` to automatically correct violations where possible
- **Config Templates** — Ships with ready-to-use ESLint v9, Ruff, Gitleaks, CommitLint, and pre-commit configs

---

## Quick Start

### 1. Installation

#### npm (Local — Recommended)

Install the plugin as a dev dependency in your project. This is the best option for teams because everyone who clones the repo gets it automatically.

```bash
npm install @theglitchking/gimme-the-lint --save-dev
```

After installing, initialize the plugin. This detects your project type, copies linting configs, sets up a Python environment (if needed), and installs git hooks:

```bash
npx gimme-the-lint install
```

#### npm (Global)

If you want the `gimme-the-lint` command available everywhere on your machine (not tied to a single project), install it globally:

```bash
npm install -g @theglitchking/gimme-the-lint
```

Then navigate to any project and run:

```bash
gimme-the-lint install
```

#### One-Line Install (curl)

If you don't want to think about npm at all, this single command downloads and installs everything globally:

```bash
curl -fsSL https://raw.githubusercontent.com/TheGlitchKing/gimme-the-lint/main/install.sh | bash
```

Then navigate to your project and run `gimme-the-lint install` to set it up.

#### Claude Code Plugin Install

If you're using Claude Code, you can install the plugin directly from the Glitch Kingdom marketplace. In your Claude Code session, run:

```
/plugin install TheGlitchKing/gimme-the-lint
```

After the plugin is installed, initialize it in your project:

```
/lint
```

The `/lint` command will detect if the plugin hasn't been set up yet and walk you through initialization. You can also run the CLI manually with `npx gimme-the-lint install` if you prefer.

---

### 2. How to Use

#### CLI Commands

| Command | Description |
|---------|-------------|
| `gimme-the-lint install` | Set up configs, templates, Python venv, and git hooks |
| `gimme-the-lint init` | Alias for `install` |
| `gimme-the-lint check` | Run progressive linting on changed files |
| `gimme-the-lint check --fix` | Auto-fix violations where possible |
| `gimme-the-lint check --all` | Lint the entire codebase, not just changed files |
| `gimme-the-lint check --frontend-only` | Only lint JavaScript/TypeScript files |
| `gimme-the-lint check --backend-only` | Only lint Python files |
| `gimme-the-lint check --verbose` | Show detailed output during linting |
| `gimme-the-lint baseline` | Create or refresh baselines for both frontend and backend |
| `gimme-the-lint baseline frontend` | Create or refresh frontend baselines only |
| `gimme-the-lint baseline backend` | Create or refresh backend baselines only |
| `gimme-the-lint dashboard` | Show the linting status dashboard with drift detection |
| `gimme-the-lint hooks` | Install pre-commit and pre-push git hooks |
| `gimme-the-lint venv setup` | Create the Python virtual environment and install tools |
| `gimme-the-lint venv status` | Show Python venv status (path, versions) |
| `gimme-the-lint status` | Show overall plugin status (project type, hooks, venv, config) |
| `gimme-the-lint uninstall` | Remove the plugin from the project (hooks and config) |

#### CLI Examples

**First-time setup on an existing project:**

You just joined a team with a large codebase that has never had linting. Run these commands to get started without breaking anything:

```bash
npx gimme-the-lint install        # Sets up configs and venv
npx gimme-the-lint baseline       # Captures all existing violations
npx gimme-the-lint hooks          # Installs git hooks
npx gimme-the-lint dashboard      # See the current state
```

From now on, every commit you make will be linted — but only your _new_ code is checked against the rules.

**Day-to-day development:**

You don't need to run anything manually. The pre-commit hook fires automatically when you `git commit`. If it finds new violations, it blocks the commit and shows you what to fix:

```bash
git add .
git commit -m "feat: add user dashboard"
# Hook fires → if violations found, it tells you what to fix

# To auto-fix and retry:
npx gimme-the-lint check --fix
git add .
git commit -m "feat: add user dashboard"
```

**Checking the full codebase before a release:**

```bash
npx gimme-the-lint check --all --verbose
```

This lints every production file (not just changed ones) and shows detailed output. Use this before merging to main or tagging a release.

**When a teammate adds a new directory:**

If someone adds `frontend/src/analytics/`, the next time anyone runs a lint check, the dashboard will warn about "directory drift." To fix it:

```bash
npx gimme-the-lint baseline       # Re-scans directories and updates manifests
```

**Scoping checks to one side of a monorepo:**

```bash
npx gimme-the-lint check --frontend-only    # Skip Python checks
npx gimme-the-lint check --backend-only     # Skip ESLint checks
```

---

#### Claude Code Commands

| Command | Description |
|---------|-------------|
| `/lint` | Run progressive linting checks on the current project |
| `/lint:status` | Show the linting dashboard with drift detection warnings |
| `/lint:baseline` | Create or refresh linting baselines |

#### Claude Code Examples

**Running a lint check during a coding session:**

While Claude Code is helping you write code, you can run `/lint` at any time to check if your changes introduce new violations. Claude will run the check, interpret the results, and either confirm everything is clean or show you exactly what to fix.

```
/lint
```

**When Claude's commit gets blocked by the pre-commit hook:**

If Claude attempts a `git commit` and the pre-commit hook detects new violations, the hook output includes LLM-specific instructions. Claude will automatically run `gimme-the-lint check --fix`, re-stage the files, and retry the commit — without asking you. If auto-fix can't resolve everything, Claude will show you the remaining issues and ask what to do.

**Checking project health:**

Use `/lint:status` to get a quick overview of your project's linting state. This shows baseline ages, drift warnings, violation counts, and whether hooks are installed. It's useful at the start of a session to understand where things stand.

```
/lint:status
```

**Refreshing baselines after a big refactor:**

After moving directories around or changing linter rules, run `/lint:baseline` to re-scan everything and update the manifests. This clears all drift warnings.

```
/lint:baseline
```

---

## Technical Details

### File Structure

```
gimme-the-lint/
├── package.json                     # npm package config (@theglitchking/gimme-the-lint)
├── action.yml                       # GitHub Action (composite) for CI/CD
├── install.sh                       # Curl-installable global install script
├── uninstall.sh                     # Clean removal with hook backup restoration
│
├── bin/
│   ├── gimme-the-lint.js            # CLI entry point (commander-based)
│   └── postinstall.js               # Post-install welcome message
│
├── lib/
│   ├── index.js                     # Re-exports all modules
│   ├── directory-discovery.js       # Auto-discovers production dirs, excludes test dirs
│   ├── manifest-manager.js          # Creates/reads/writes manifests with MD5 config hashes
│   ├── drift-detector.js            # Detects 4 drift types, formats reports, auto-heals
│   ├── venv-manager.js              # Python venv creation, dependency install, status
│   ├── config-manager.js            # Template copying with {{substitutions}}, project detection
│   ├── git-hooks-manager.js         # Hook install/uninstall with backup/restore
│   └── installer.js                 # Full init flow orchestrator
│
├── scripts/
│   ├── run-checks.sh                # Main progressive linting script (pre-commit entry)
│   ├── dashboard.sh                 # Status dashboard with drift warnings
│   ├── eslint-baseline.sh           # Frontend baseline creator with auto-discovery
│   ├── ruff-baseline.sh             # Backend baseline creator with per-dir JSON baselines
│   ├── setup-venv.sh                # Python venv setup with version checking
│   └── validate-version.sh          # Pre-publish validation (changelog, license)
│
├── templates/
│   ├── eslint.config.template.js    # ESLint v9 flat config (React, TS, import rules)
│   ├── pyproject.template.toml      # Ruff + pytest + mypy + coverage config
│   ├── .gitleaks.template.toml      # Secrets detection with API key patterns
│   ├── commitlint.config.template.js# Conventional commits enforcement
│   ├── .pre-commit-config.template.yaml # Pre-commit hooks (ruff, prettier, gitleaks)
│   └── requirements.linting.txt     # Python deps: ruff, mypy, pytest, pytest-cov
│
├── githooks/
│   ├── pre-commit                   # Changed-files lint (~30s), LLM instructions on fail
│   ├── pre-push                     # Full codebase lint
│   └── install.sh                   # Hook installer (copies to .git/hooks/)
│
├── .claude-plugin/
│   ├── plugin.json                  # Plugin manifest (commands, agents, metadata)
│   └── commands/
│       ├── lint.md                  # /lint command with pre-commit workflow
│       ├── lint-status.md           # /lint:status dashboard command
│       └── lint-baseline.md         # /lint:baseline command
│
├── agents/
│   └── linting-agent.md             # Background linting agent instructions
│
├── .github/workflows/
│   └── lint.template.yml            # Ready-to-copy workflow template for consumers
│
├── .documentation/
│   ├── installation-guide.md        # Full installation instructions
│   ├── when-to-use-guide.md         # Decision guide for adoption
│   ├── how-to-use-guide.md          # Detailed usage reference
│   └── troubleshooting-guide.md     # Common issues and fixes
│
└── tests/
    ├── directory-discovery.test.js  # 8 tests: dir detection, filtering, git changes
    ├── manifest-manager.test.js     # 9 tests: hash, age, CRUD operations
    ├── drift-detector.test.js       # 10 tests: 4 drift types, reports, auto-heal
    └── config-manager.test.js       # 8 tests: project detection, templates, config
```

### Architecture Overview

The plugin has three main layers:

**1. Shell Scripts (`scripts/`)** — The core linting engine. These bash scripts handle the actual ESLint and Ruff invocations, baseline file creation, and dashboard rendering. They're designed to work standalone (called by git hooks or the GitHub Action) without needing Node.js at runtime.

**2. Node.js Library (`lib/`)** — JavaScript modules that handle project detection, manifest management, drift detection, venv management, and git hook installation. The CLI (`bin/gimme-the-lint.js`) orchestrates these modules via commander.

**3. Integration Layer** — The GitHub Action (`action.yml`), Claude Code plugin (`.claude-plugin/`), and git hooks (`githooks/`) connect the core engine to different environments. Each integration knows how to invoke `run-checks.sh` and interpret its output for its specific context.

### How Progressive Linting Works

1. **Baseline Phase**: `eslint-baseline.sh` and `ruff-baseline.sh` scan every production directory, run the linter, and save the violation list to per-directory JSON files in `.lttf/` (frontend) and `.lttf-ruff/` (backend). A manifest (`.lttf-manifest.json`) records the directory list, violation counts, and an MD5 hash of the linter config.

2. **Check Phase**: `run-checks.sh` uses `git diff --cached` to find staged files, maps them to directories, and runs the linter only on those directories. It compares the results against the baseline — if the only violations found are ones already in the baseline, the check passes.

3. **Drift Phase**: On every check, `drift-detector.js` compares the current state against the manifest. It flags four types of drift:
   - **Directory drift**: A directory was added or removed since the last baseline
   - **Config drift**: The linter config file's MD5 hash doesn't match the manifest
   - **Time drift**: The baseline is older than 30 days
   - **Violation drift**: The violation count changed (could mean progress or regression)

4. **Heal Phase**: When you re-run `baseline`, the manifest auto-updates with the new directory list, config hash, and timestamp. Changes are logged so you can track what drifted.

### Directory Discovery

The auto-discovery system in `directory-discovery.js` uses `find` to locate all directories under your source roots, then filters out anything matching test patterns:

**Excluded patterns**: `__tests__`, `__test__`, `test`, `tests`, `testing`, `e2e`, `cypress`, `playwright`, `__mocks__`, `__fixtures__`, `__snapshots__`, `__pycache__`, `.hidden`, `node_modules`, `dist`, `build`, `.next`, `.nuxt`

This means you never need to manually configure which directories to lint. When someone adds `frontend/src/payments/`, it's automatically included on the next run.

### GitHub Action

The composite action (`action.yml`) sets up Node.js and Python, installs dependencies with caching, and runs the lint checks. It supports two modes:

- **Progressive** (default): Only checks files changed in the PR
- **Full**: Checks the entire codebase

When `comment-on-pr: true` is set, it posts a formatted summary as a PR comment using `actions/github-script`, including violation counts, drift warnings, and status badges.

### Edge Cases Handled

- **No git repository**: `getChangedFiles()` returns empty arrays gracefully; hooks skip without error
- **No baselines yet**: Linting still runs but treats everything as new (blocks until baselines are created)
- **Empty project**: `detectProjectType()` returns `unknown`; init warns and skips auto-config
- **Missing Python**: Venv setup is skipped with a warning; frontend linting still works
- **Corrupt manifest**: Re-running `baseline` creates a fresh manifest from scratch
- **Conflicting hooks**: Existing git hooks are backed up to `.git/hooks/pre-commit.backup.<timestamp>` before overwriting; uninstall restores them

### Supported Project Structures

| Structure | Frontend Path | Backend Path | Detection |
|-----------|--------------|-------------|-----------|
| Monorepo | `frontend/src/` | `backend/app/` | Both `frontend/` and `backend/` dirs exist |
| Frontend-only | `src/` | — | `src/` + `package.json`, no `backend/` |
| Backend-only | — | `app/` | `app/` + `pyproject.toml`, no `frontend/` |

### Requirements

- **Node.js** >= 18.0.0
- **Python** >= 3.11 (for backend linting; optional)
- **Git** (for hooks and changed-file detection)
- **ESLint** >= 9.0.0 (frontend; optional peer dependency)
- **jq** (for manifest operations in shell scripts)

---

## Roadmap

### v1.1 — Enhanced Linter Support
- Additional Python linters (pylint, flake8)
- Legacy JS linter support (TSLint)
- Custom rule presets
- Parallel directory processing
- Team dashboard (weekly health scorecard)

### v1.2 — Observability & Integrations
- Web dashboard (localhost:3000/lint-dashboard)
- VS Code extension integration
- Slack/Discord notifications for CI failures
- Drift history tracking (timeline of changes)
- Automated baseline refresh (scheduled via cron)

### v2.0 — Multi-Language & Enterprise
- Multi-language support (Go, Rust, Java)
- Cloud-based baseline storage
- Team collaboration features
- AI-powered violation triage (auto-prioritize fixes)
- Cross-repo baseline sharing

---

## Marketplace

Published to the [Glitch Kingdom Marketplace](https://github.com/TheGlitchKing/glitch-kingdom-of-plugins):

```bash
# Via Claude marketplace
/plugin install TheGlitchKing/gimme-the-lint

# Via npm
npm install --save-dev @theglitchking/gimme-the-lint
```

## License

MIT — see [LICENSE](LICENSE)
