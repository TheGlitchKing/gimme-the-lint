# /lint:status - Progressive Linting Dashboard

Show the current state of progressive linting across the codebase.

## What It Shows

- **Frontend (ESLint)**: Baseline status, directory count, violation count, drift warnings
- **Backend (Ruff)**: Baseline status, directory count, violation count, drift warnings
- **Drift Detection**: Directory drift, config drift, time drift (>30 days)
- **Overall Health**: Whether baselines are active and up to date

## Usage

Run the dashboard script:
```bash
gimme-the-lint dashboard
```

## Drift Types

| Drift Type | Meaning | Action |
|-----------|---------|--------|
| Directory | New directories not in baseline | Run `gimme-the-lint baseline` |
| Config | Linter config changed | Re-run baseline to capture new rules |
| Time | Baseline >30 days old | Consider refreshing baseline |
| Violation | Violation count changed | Check if progress is being made |
