# /lint - Progressive Linting

Run progressive linting checks on the current project. Only NEW violations are flagged — baseline violations are ignored.

## Quick Reference

| Command | Description |
|---------|-------------|
| `gimme-the-lint check` | Lint changed files only |
| `gimme-the-lint check --fix` | Auto-fix violations |
| `gimme-the-lint check --all` | Lint entire codebase |
| `gimme-the-lint check --frontend-only` | Frontend only |
| `gimme-the-lint check --backend-only` | Backend only |
| `gimme-the-lint check --verbose` | Detailed output |

## LLM Pre-Commit Workflow

When a commit fails due to linting violations:

1. **AUTOMATICALLY** run `gimme-the-lint check --fix` (do NOT ask user first)
2. Re-stage the fixed files with `git add`
3. Retry the commit
4. Only ask the user if manual fixes are needed after auto-fix fails

## How Progressive Linting Works

- **Baselines** capture existing violations at a point in time
- **New code** must pass all lint rules (zero new violations)
- **Old violations** are tracked but not blocking
- **Directory-chunked**: only lint directories with changes (faster)
- **Drift detection**: warns when project structure changes

## File Locations

| File | Purpose |
|------|---------|
| `frontend/.lttf/` | Frontend baseline data |
| `backend/.lttf-ruff/` | Backend baseline data |
| `.baseline-manifest.json` | Manifest with metadata, drift tracking |
| `gimme-the-lint.config.js` | Plugin configuration |
