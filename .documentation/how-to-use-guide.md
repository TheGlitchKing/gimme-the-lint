# How to Use gimme-the-lint

## Quick Start

```bash
# Install
npm install @theglitchking/gimme-the-lint --save-dev

# Initialize (auto-detects project type)
npx gimme-the-lint init

# Create baselines for existing violations
npx gimme-the-lint baseline

# Run a lint check
npx gimme-the-lint check
```

## CLI Commands

### `gimme-the-lint init`

Initializes the plugin in your project. Run this once after installing.

```bash
npx gimme-the-lint init [options]

Options:
  --skip-venv    Skip Python virtual environment creation
  --skip-hooks   Skip git hooks installation
```

What it does:
- Detects project type (monorepo, frontend-only, backend-only)
- Copies config templates to your project root
- Creates `.venv` with ruff, mypy, pytest (if backend detected)
- Installs pre-commit and pre-push git hooks

### `gimme-the-lint check`

Runs progressive linting on your project.

```bash
npx gimme-the-lint check [options]

Options:
  --all              Lint entire codebase (not just changed files)
  --fix              Auto-fix violations where possible
  --verbose          Show detailed output
  --frontend-only    Only run frontend linting (ESLint)
  --backend-only     Only run backend linting (Ruff)
```

Examples:
```bash
# Lint only files changed since last commit
npx gimme-the-lint check

# Lint everything with auto-fix
npx gimme-the-lint check --all --fix

# Verbose frontend-only check
npx gimme-the-lint check --frontend-only --verbose
```

### `gimme-the-lint baseline`

Creates or updates violation baselines. Existing violations are recorded so they don't block future commits.

```bash
npx gimme-the-lint baseline [options]

Options:
  --frontend-only    Only baseline frontend (ESLint)
  --backend-only     Only baseline backend (Ruff)
```

What happens:
1. Runs the full linter across all production directories
2. Records violations per directory in `.lttf/` (frontend) or `.lttf-ruff/` (backend)
3. Creates a manifest with directory list, config hash, and timestamp
4. If a manifest already exists, auto-heals (updates and logs changes)

### `gimme-the-lint dashboard`

Shows a unified status dashboard.

```bash
npx gimme-the-lint dashboard
```

Displays:
- Project type and detected directories
- Frontend baseline status (per-directory violation counts)
- Backend baseline status (per-directory violation counts)
- Drift warnings (directory drift, config drift, time drift)
- Manifest health (age, hash, directory count)

### `gimme-the-lint hooks`

Manage git hooks.

```bash
# Install hooks
npx gimme-the-lint hooks install

# Remove hooks (restores backups)
npx gimme-the-lint hooks uninstall

# Check hook status
npx gimme-the-lint hooks status
```

### `gimme-the-lint venv`

Manage the Python virtual environment.

```bash
# Create/recreate venv
npx gimme-the-lint venv setup

# Check venv status
npx gimme-the-lint venv status
```

### `gimme-the-lint status`

Shows overall plugin status (hooks, venv, baselines, config).

```bash
npx gimme-the-lint status
```

## Git Hooks

### Pre-commit Hook

Runs automatically when you `git commit`. It:
1. Detects files staged for commit (`git diff --cached`)
2. Splits them into frontend (`.js`, `.ts`, `.jsx`, `.tsx`) and backend (`.py`)
3. Runs ESLint on frontend files, Ruff on backend files
4. Compares results against baselines — only NEW violations block the commit
5. Runs in ~30 seconds (changed files only)

### Pre-push Hook

Runs automatically when you `git push`. It:
1. Runs the full linter across the entire codebase (`--all` mode)
2. Checks for drift (directory changes, config changes, stale baselines)
3. Blocks the push if new violations are found

### Bypassing Hooks

In emergencies, you can skip hooks:
```bash
git commit --no-verify -m "emergency fix"
git push --no-verify
```

This is not recommended for regular use.

## GitHub Action

### Basic Setup

Create `.github/workflows/lint.yml`:

```yaml
name: Progressive Lint
on:
  pull_request:
    branches: [main, develop]

permissions:
  contents: read
  pull-requests: write

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: TheGlitchKing/gimme-the-lint@v1
        with:
          mode: progressive
          comment-on-pr: true
```

### Action Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `mode` | `progressive` | `progressive` (changed files) or `full` (entire codebase) |
| `fix` | `false` | Auto-fix violations |
| `frontend` | `true` | Enable ESLint checks |
| `backend` | `true` | Enable Ruff checks |
| `python-version` | `3.13` | Python version for backend |
| `node-version` | `22` | Node.js version |
| `working-directory` | `.` | Working directory |
| `comment-on-pr` | `true` | Post results as PR comment |

### Action Outputs

| Output | Description |
|--------|-------------|
| `frontend-status` | `pass`, `fail`, or `skip` |
| `backend-status` | `pass`, `fail`, or `skip` |
| `drift-detected` | `true` or `false` |
| `violations-count` | Number of new violations found |

### Advanced: Conditional Steps

```yaml
- uses: TheGlitchKing/gimme-the-lint@v1
  id: lint
  with:
    mode: progressive

- name: Fail if violations found
  if: steps.lint.outputs.violations-count > 0
  run: exit 1

- name: Warn on drift
  if: steps.lint.outputs.drift-detected == 'true'
  run: echo "::warning::Lint drift detected - consider re-running baseline"
```

## Claude Code Integration

### Slash Commands

If your project uses Claude Code, these commands are available:

- **`/lint`** — Run progressive linting with LLM-optimized output. Claude will analyze failures and suggest fixes.
- **`/lint:status`** — View the linting dashboard with drift warnings.
- **`/lint:baseline`** — Create or update baselines. Claude guides you through the process.

### Linting Agent

The background linting agent (`agents/linting-agent.md`) can be invoked by Claude Code to:
- Continuously monitor for lint violations
- Suggest fixes with explanations
- Auto-fix safe violations (formatting, import ordering)
- Flag violations that need human review

## Drift Detection

gimme-the-lint tracks four types of drift:

### Directory Drift
New directories added or existing directories removed since the last baseline. Indicates the baseline may be incomplete.

### Config Drift
Linter config files (`eslint.config.js`, `pyproject.toml`) changed since the last baseline. Indicates rules may have changed and baselines need updating.

### Time Drift
Baselines older than 30 days. A gentle reminder to re-run baselines and verify they're still accurate.

### Violation Drift
Violation counts increased beyond the baseline. Indicates new violations were introduced without being caught.

### Responding to Drift

When drift is detected:
```bash
# View what drifted
npx gimme-the-lint dashboard

# Re-run baselines (auto-heals manifests)
npx gimme-the-lint baseline
```

Auto-healing updates the manifest with current directory lists, config hashes, and timestamps while logging what changed.

## Configuration Files

After `init`, these files are created in your project:

| File | Purpose |
|------|---------|
| `eslint.config.js` | ESLint v9 flat config with React, TS, import rules |
| `pyproject.toml` | Ruff, pytest, mypy, coverage config |
| `.gitleaks.toml` | Secrets detection rules |
| `.pre-commit-config.yaml` | Pre-commit hooks config |
| `commitlint.config.js` | Conventional commits enforcement |

These are templates — customize them for your project after initialization.

## Common Workflows

### Adding a New Lint Rule

1. Add the rule to your config (`eslint.config.js` or `pyproject.toml`)
2. Run `npx gimme-the-lint baseline` to baseline existing violations of the new rule
3. Commit the updated config and baselines
4. From now on, only new violations of the rule block commits

### Onboarding a New Team Member

1. Clone the repo
2. Run `npm install` (installs gimme-the-lint as devDependency)
3. Run `npx gimme-the-lint init` (sets up hooks and venv)
4. Start coding — hooks enforce linting automatically

### Periodic Baseline Refresh

Every few weeks:
1. Run `npx gimme-the-lint dashboard` to check for drift
2. Run `npx gimme-the-lint baseline` to update baselines
3. Commit updated baselines
4. Review the auto-heal log to see what changed
