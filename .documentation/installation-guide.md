# Installation Guide

gimme-the-lint v2.0 — polyglot progressive linting.

## Requirements

- **Node.js** >= 20
- **Git** — for hooks and staged-file detection
- A linter for each language you lint:
  - JavaScript/TypeScript — `eslint` **or** `biome`
  - Python — `ruff`
  - Go — `golangci-lint`
  - Rust — `clippy` (ships with the Rust toolchain)

Any language whose linter is not installed is simply skipped (see the
troubleshooting guide) — gimme-the-lint never hard-requires a toolchain.

## Install

### npm — local (recommended)

Best for teams: everyone who clones the repo gets it.

```bash
npm install --save-dev @theglitchking/gimme-the-lint
npx gimme-the-lint install
```

### npm — global

```bash
npm install -g @theglitchking/gimme-the-lint
gimme-the-lint install
```

### Claude Code plugin

```
/plugin install TheGlitchKing/gimme-the-lint
```

## Install modes

| Mode | Command | Use when |
|------|---------|----------|
| Standard | `gimme-the-lint install` | Normal projects with internet access |
| Offline | `gimme-the-lint install --offline` | Air-gapped / regulated workstations — no npm/pip fetches; the toolchain is provisioned by your image. Fails loudly if a linter is missing for code that is present. |
| Greenfield | `gimme-the-lint init --no-baseline` | Brand-new repos — writes empty baselines and installs hooks so every violation is new ("strict from day one") |

## After installing

```bash
gimme-the-lint baseline      # capture existing violations as baselines
gimme-the-lint hooks         # install pre-commit + pre-push hooks
gimme-the-lint dashboard     # review baseline status and drift
```

Commit the generated `.gtl/` directory — it is the team-shared baseline.

## Upgrading from v1

v2 changes the baseline layout, baseline format, and config schema. Run:

```bash
gimme-the-lint migrate
```

It backs the legacy `.lttf/` + `.lttf-ruff/` directories up under
`.gtl/legacy-backup/` and re-baselines into the v2 `.gtl/` layout. See
`CHANGELOG.md` for the full breaking-change list.

## Uninstall

```bash
gimme-the-lint uninstall
```

Removes git hooks and `gimme-the-lint.config.js`. Baselines (`.gtl/`), linter
configs, and `.venv` are left in place — remove them manually if desired.
