# gimme-the-lint

Progressive linting system with directory-chunked baselines, drift detection, and auto-healing for monorepo projects (Python + JS/TS).

**Only NEW violations block commits. Old violations are baselined and tracked for progressive cleanup.**

## Features

- **Progressive Linting** - Baseline existing violations, only block new ones
- **Directory-Chunked Auto-Discovery** - Auto-detects production directories, scales without config
- **Manifest-Based Drift Detection** - Detects directory, config, time, and violation drift
- **Auto-Healing** - Manifests auto-update when re-running baselines
- **Python .venv Management** - Auto-creates virtual environment with ruff, mypy
- **Git Hooks** - Pre-commit (changed files only, ~30s) and pre-push (full lint)
- **GitHub Action** - CI/CD integration with PR comments
- **Claude Code Plugin** - /lint, /lint:status, /lint:baseline commands
- **LLM-Optimized** - Pre-commit output instructs Claude Code to auto-fix without asking

## Quick Start

```bash
# Install
npm install --save-dev @theglitchking/gimme-the-lint

# Initialize configs and Python venv
npx gimme-the-lint install

# Create baselines (capture existing violations)
npx gimme-the-lint baseline

# Install git hooks
npx gimme-the-lint hooks

# Check status
npx gimme-the-lint dashboard
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `gimme-the-lint install` | Initialize configs, templates, and Python venv |
| `gimme-the-lint check` | Run progressive linting on changed files |
| `gimme-the-lint check --fix` | Auto-fix violations |
| `gimme-the-lint check --all` | Lint entire codebase |
| `gimme-the-lint check --frontend-only` | Frontend only |
| `gimme-the-lint check --backend-only` | Backend only |
| `gimme-the-lint baseline` | Create/refresh baselines (frontend + backend) |
| `gimme-the-lint baseline frontend` | Frontend baselines only |
| `gimme-the-lint baseline backend` | Backend baselines only |
| `gimme-the-lint dashboard` | Show linting status dashboard |
| `gimme-the-lint hooks` | Install git hooks |
| `gimme-the-lint venv setup` | Setup Python virtual environment |
| `gimme-the-lint venv status` | Show venv status |
| `gimme-the-lint status` | Show overall plugin status |
| `gimme-the-lint uninstall` | Remove plugin from project |

## How It Works

### Progressive Linting

Traditional linting blocks all commits if any violations exist. For large codebases with thousands of existing violations, this makes adoption impossible.

**gimme-the-lint** takes a different approach:

1. **Baseline** - Capture all existing violations at a point in time
2. **Gate** - Only NEW violations (not in baseline) block commits
3. **Track** - Monitor progress as old violations are gradually fixed
4. **Scale** - Per-directory baselines mean only changed directories are re-checked

### Directory-Chunked Auto-Discovery

Instead of configuring which directories to lint, gimme-the-lint automatically discovers all production directories:

```
frontend/src/
  api/          <- auto-discovered
  components/   <- auto-discovered
  features/     <- auto-discovered
  hooks/        <- auto-discovered
  __tests__/    <- excluded (test directory)
  e2e/          <- excluded (test directory)

backend/app/
  routers/      <- auto-discovered
  services/     <- auto-discovered
  models/       <- auto-discovered
  tests/        <- excluded (test directory)
  __pycache__/  <- excluded
```

When you add a new directory, it's automatically included in the next baseline run. No config changes needed.

### Drift Detection

gimme-the-lint creates manifest files that track baseline state. On every run, it checks for 4 types of drift:

| Drift Type | What Changed | Auto-Action |
|-----------|-------------|-------------|
| **Directory** | New/removed directories | Warns, auto-heals on re-baseline |
| **Config** | Linter config file changed | Warns baseline may be stale |
| **Time** | Baseline >30 days old | Suggests refresh |
| **Violation** | Count changed vs baseline | Shows progress/regression |

### Manifest Format

```json
{
  "created_at": "2026-02-03T00:00:00Z",
  "tool": "eslint",
  "version": "9.0.0",
  "directories_baselined": ["api", "components", "features", "hooks"],
  "total_directories": 4,
  "total_violations": 42,
  "config_hash": "abc123def456",
  "test_excluded": ["__tests__", "e2e", "*.test.*"]
}
```

## GitHub Action

Use gimme-the-lint in your CI/CD pipeline:

```yaml
# .github/workflows/lint.yml
name: Lint
on:
  pull_request:
    branches: [main]

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
          mode: progressive     # or 'full'
          frontend: true
          backend: true
          comment-on-pr: true   # Posts results as PR comment
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
| `comment-on-pr` | `true` | Post results as PR comment |

### Action Outputs

| Output | Description |
|--------|-------------|
| `frontend-status` | `pass`, `fail`, or `skip` |
| `backend-status` | `pass`, `fail`, or `skip` |
| `drift-detected` | `true` if baseline drift detected |
| `violations-count` | Number of new violations found |

## Claude Code Integration

gimme-the-lint integrates with Claude Code as a plugin:

```
/lint          Run progressive linting checks
/lint:status   Show dashboard with drift detection
/lint:baseline Create or refresh baselines
```

### LLM Pre-Commit Workflow

When a commit fails due to linting, the pre-commit hook outputs LLM-specific instructions:

```
For LLMs (Claude Code):
  AUTOMATICALLY run: gimme-the-lint check --fix
  Re-stage files and retry commit
  ONLY ask user if manual fixes needed after auto-fix
```

## Project Structure

```
gimme-the-lint/
├── action.yml                    # GitHub Action (composite)
├── package.json                  # npm package
├── install.sh                    # Global install script
├── uninstall.sh                  # Uninstall script
├── bin/
│   ├── gimme-the-lint.js         # CLI entry point
│   └── postinstall.js            # Post-install message
├── scripts/
│   ├── run-checks.sh             # Progressive linting
│   ├── dashboard.sh              # Status dashboard
│   ├── eslint-baseline.sh        # Frontend baseline creator
│   ├── ruff-baseline.sh          # Backend baseline creator
│   ├── setup-venv.sh             # Python venv setup
│   └── validate-version.sh       # Pre-publish validation
├── lib/
│   ├── index.js                  # Module exports
│   ├── directory-discovery.js    # Auto-discover directories
│   ├── manifest-manager.js       # Manifest CRUD
│   ├── drift-detector.js         # Drift detection & auto-healing
│   ├── venv-manager.js           # Python venv management
│   ├── config-manager.js         # Config templates
│   ├── git-hooks-manager.js      # Git hooks install/uninstall
│   └── installer.js              # Interactive setup
├── templates/
│   ├── eslint.config.template.js
│   ├── pyproject.template.toml
│   ├── .gitleaks.template.toml
│   ├── commitlint.config.template.js
│   ├── .pre-commit-config.template.yaml
│   └── requirements.linting.txt
├── githooks/
│   ├── pre-commit
│   ├── pre-push
│   └── install.sh
├── .claude-plugin/
│   ├── plugin.json
│   └── commands/
│       ├── lint.md
│       ├── lint-status.md
│       └── lint-baseline.md
├── agents/
│   └── linting-agent.md
└── .github/workflows/
    └── lint.template.yml         # Workflow template for consumers
```

## Configuration

Create `gimme-the-lint.config.js` in your project root (auto-generated by `gimme-the-lint install`):

```javascript
module.exports = {
  projectType: 'monorepo',    // 'monorepo', 'frontend', 'backend'
  frontendDir: 'frontend',
  backendDir: 'backend',
  srcDir: 'src',
  appDir: 'app',
};
```

## Supported Project Structures

| Structure | Frontend | Backend |
|-----------|----------|---------|
| Monorepo | `frontend/src/` | `backend/app/` |
| Frontend-only | `src/` | - |
| Backend-only | - | `app/` |

## Requirements

- **Node.js** >= 18.0.0
- **Python** >= 3.8 (for backend linting)
- **Git** (for hooks and changed file detection)
- **ESLint** >= 9.0.0 (frontend, peer dependency)
- **jq** (for manifest operations in shell scripts)

## Roadmap

### v1.1 - Enhanced Linter Support
- Support for additional Python linters (pylint, flake8)
- Support for legacy JS linters (TSLint)
- Custom rule presets
- Parallel directory processing (lint multiple dirs concurrently)
- Team dashboard (weekly health scorecard)

### v1.2 - Observability & Integrations
- Web dashboard (localhost:3000/lint-dashboard)
- VS Code extension integration
- Slack/Discord notifications for CI failures
- Drift history tracking (timeline of baseline changes)
- Automated baseline refresh (scheduled via cron)

### v2.0 - Multi-Language & Enterprise
- Multi-language support (Go, Rust, Java)
- Cloud-based baseline storage
- Team collaboration features
- AI-powered violation triage (auto-prioritize fixes)
- Cross-repo baseline sharing (enterprise feature)

## Marketplace

This plugin is published to the [Glitch Kingdom Marketplace](https://github.com/TheGlitchKing/glitch-kingdom-of-plugins):

```bash
# Via Claude marketplace
/plugin install TheGlitchKing/gimme-the-lint

# Via npm
npm install -g @theglitchking/gimme-the-lint
```

## License

MIT - see [LICENSE](LICENSE)
