---
description: Run progressive linting checks on the current project (only NEW violations above the baseline are flagged)
---

# /lint - Progressive Linting

Run progressive linting checks on the current project. Only NEW violations are
flagged — baselined violations are grandfathered and never block.

## Quick Reference

| Command | Description |
|---------|-------------|
| `gimme-the-lint check` | Lint files staged for commit |
| `gimme-the-lint check --fix` | Auto-fix violations where the linter supports it |
| `gimme-the-lint check --all` | Lint every app, not just staged changes |
| `gimme-the-lint check --strict` | Fail if a linter is missing for code that is present |

## LLM Pre-Commit Workflow

When a commit fails due to linting violations:

1. **AUTOMATICALLY** run `gimme-the-lint check --fix` (do NOT ask the user first)
2. Re-stage the fixed files with `git add`
3. Retry the commit
4. Only ask the user if manual fixes are needed after auto-fix fails

## How Progressive Linting Works

- **Baselines** capture existing violations as line-independent fingerprints
- **New code** must add zero new violations
- **Baselined violations** survive code moving up/down a file — only genuinely
  new problems are flagged
- **Per app**: each app is linted by the linters its manifest implies
- **Idempotent skip**: an app with code but no installed linter is warn-skipped
  (it never blocks) — unless `--strict` is set

## Supported linters

| Language | Linter |
|----------|--------|
| JavaScript / TypeScript | `eslint` |
| Python | `ruff` |
| Go | `golangci-lint` |
| Rust | `clippy` (`cargo clippy`) |

## File Locations

| Path | Purpose |
|------|---------|
| `.gtl/apps/<app>/baseline.json` | Per-app baseline (fingerprints per linter) |
| `.gtl/manifest.json` | Global manifest — versions, config hashes, drift |
| `gimme-the-lint.config.js` | Optional configuration (app→linter binding) |

## Configuration

Auto-detection binds each package to its linter with no config. To override:

```js
module.exports = {
  apps: {
    'apps/orders-api':    { linters: ['eslint'] },
    'apps/orders-worker': { linters: ['ruff'] },
  },
  skipPatterns: ['_template-*'],
};
```
