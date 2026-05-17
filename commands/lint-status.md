---
description: Show the progressive linting dashboard — per-app baseline status and drift detection
---

# /lint:status - Progressive Linting Dashboard

Show the current state of progressive linting across every app in the project.

## Usage

```bash
gimme-the-lint dashboard
```

## What It Shows

- **Per app**: each app, the linters bound to it, baselined violation counts,
  and linter versions
- **Skipped apps**: apps with code but no installed linter
- **Drift**: anything that has moved since the last baseline

## Drift Types

| Drift Type | Meaning | Action |
|------------|---------|--------|
| App added | A new app appeared since the last baseline | Run `gimme-the-lint baseline` |
| App removed | A baselined app no longer exists | Run `gimme-the-lint baseline` |
| Config | A linter's config file changed | Re-baseline to capture new rules |
| Version | A linter's version changed | Re-baseline to align with the new linter |
| Time | Baseline is >30 days old | Consider refreshing |

Drift is tracked **per app** — a config or version change in one app never
churns the baselines of unrelated apps.
