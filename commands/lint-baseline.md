---
description: Create or refresh progressive-lint baselines (captures existing violations so only NEW ones block future commits)
---

# /lint:baseline - Create or Refresh Baselines

Capture the current violations for every app so that only NEW violations block
future commits. Baselines are stored under `.gtl/` and meant to be committed.

## Usage

```bash
# Baseline every app in the project
gimme-the-lint baseline

# Greenfield: write EMPTY baselines (every violation counts as new)
gimme-the-lint baseline --empty

# Fail if a linter is missing for code that is present
gimme-the-lint baseline --strict
```

## What Happens

1. **Discovers apps** by walking the repo for package manifests
   (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`)
2. **Runs each app's linter** and captures violations as line-independent
   fingerprints
3. **Writes** `.gtl/apps/<app>/baseline.json` — one section per linter
4. **Refreshes** the global manifest `.gtl/manifest.json` (linter versions,
   config hashes, per-app status) for drift detection
5. **Warn-skips** any app whose linter binary is not installed, recording a
   `skipped` status

## When to Run

- After initial setup (`gimme-the-lint install`)
- When adding a new app or language to the monorepo
- When changing a linter's configuration
- Periodically, to refresh stale baselines (the dashboard flags >30 days)
- After merging a large refactor

## Greenfield projects

For a brand-new repo with no legacy violations, `--empty` (or
`gimme-the-lint init --no-baseline`) installs the system in "strict from day
one" mode — every violation is treated as new, nothing is grandfathered.
