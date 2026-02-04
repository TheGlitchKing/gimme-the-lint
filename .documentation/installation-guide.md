# Installation Guide

## Prerequisites

- **Node.js** >= 18.0.0
- **npm** >= 8.0.0
- **Git** (for hooks and change detection)
- **Python** >= 3.11 (optional, for backend linting with Ruff)

## Quick Install (npm)

### Local (recommended for projects)

```bash
npm install @theglitchking/gimme-the-lint --save-dev
```

### Global

```bash
npm install -g @theglitchking/gimme-the-lint
```

## One-Line Install (curl)

```bash
curl -fsSL https://raw.githubusercontent.com/TheGlitchKing/gimme-the-lint/main/install.sh | bash
```

This installs the package globally and runs the post-install setup.

## Initialize in Your Project

After installing, run:

```bash
npx gimme-the-lint init
```

This will:

1. Detect your project type (monorepo, frontend-only, backend-only)
2. Copy appropriate config templates (ESLint, Ruff, Gitleaks, etc.)
3. Set up Python virtual environment (if backend detected)
4. Install git hooks (pre-commit, pre-push)
5. Create initial lint manifests

### Init Options

```bash
# Skip Python venv creation
npx gimme-the-lint init --skip-venv

# Skip git hooks installation
npx gimme-the-lint init --skip-hooks
```

## Project Type Detection

The installer auto-detects your project type:

| Type | Detection Criteria |
|------|-------------------|
| **Monorepo** | Has both `frontend/` and `backend/` directories |
| **Frontend-only** | Has `src/` dir + `package.json`, no `backend/` |
| **Backend-only** | Has `app/` dir + `pyproject.toml`, no `frontend/` |
| **Unknown** | None of the above — manual config required |

## Peer Dependencies

These are optional but recommended:

- **eslint** >= 9.0.0 — Required for frontend linting (ESLint v9 flat config)
- **ruff** — Installed automatically in `.venv` for backend linting

## Verifying Installation

```bash
# Check CLI is available
npx gimme-the-lint --version

# Check full status
npx gimme-the-lint status

# View the dashboard
npx gimme-the-lint dashboard
```

## GitHub Action Setup

Add to your workflow (`.github/workflows/lint.yml`):

```yaml
name: Lint
on: [pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: TheGlitchKing/gimme-the-lint@v1
        with:
          mode: check
          comment-on-pr: true
```

See the [how-to-use guide](./how-to-use-guide.md) for full GitHub Action configuration.

## Claude Code Plugin

If using Claude Code, the plugin is automatically available after npm install:

```bash
# In Claude Code, use slash commands:
/lint          # Run progressive linting
/lint:status   # View dashboard
/lint:baseline # Create new baselines
```

## Uninstalling

```bash
# Remove the package
npm uninstall @theglitchking/gimme-the-lint

# Or use the cleanup script (restores original git hooks)
npx gimme-the-lint uninstall
```

The uninstall script will:
- Remove installed git hooks
- Restore any backed-up original hooks
- Remove the CLI

It will **NOT** remove (clean up manually if desired):
- `.venv/` — Python virtual environment
- `frontend/.lttf/` — ESLint baseline files
- `backend/.lttf-ruff/` — Ruff baseline files
- Config files (`eslint.config.js`, `pyproject.toml`, `.gitleaks.toml`, etc.)
