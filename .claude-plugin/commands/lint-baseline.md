# /lint:baseline - Create or Refresh Baselines

Create LTTF baselines for progressive linting. Baselines capture existing violations so only NEW violations block commits.

## Usage

```bash
# Both frontend and backend
gimme-the-lint baseline

# Frontend only
gimme-the-lint baseline frontend

# Backend only
gimme-the-lint baseline backend
```

## What Happens

1. **Auto-discovers** all production directories (excludes test dirs)
2. **Runs linter** on each directory
3. **Saves violations** as per-directory baseline files
4. **Creates manifest** with metadata (timestamp, directory list, config hash)
5. **Detects drift** if previous manifest exists (added/removed dirs, config changes)
6. **Auto-heals** by updating manifest to reflect current state

## When to Run

- After initial setup (`gimme-the-lint install`)
- When adding new directories to the project
- When changing linter configuration (eslint.config.js, pyproject.toml)
- Periodically to refresh stale baselines (>30 days)
- After merging large refactors
