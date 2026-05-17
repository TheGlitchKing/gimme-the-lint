# Troubleshooting Guide

## "⚠ SKIPPED — &lt;linter&gt; not installed"

**Cause:** an app contains code for a language whose linter binary is not on
`PATH` (or in the project's `node_modules`/`.venv`).

**This is intentional.** A missing linter never blocks a commit — gimme-the-lint
skips that app and records the gap. To actually lint that code, install the
linter:

- ESLint: `npm install --save-dev eslint`
- Biome: `npm install --save-dev @biomejs/biome`
- Ruff: `pip install ruff` (into the project `.venv`)
- Go: install `golangci-lint`
- Rust: `clippy` ships with `rustup`

To make a missing linter a hard error instead, run `check --strict`.

## `check` says "Legacy v1 baselines (.lttf/) detected"

The project still uses the v1 layout. Run:

```bash
gimme-the-lint migrate
```

It backs the legacy directories up under `.gtl/legacy-backup/` and rebuilds
baselines in the v2 `.gtl/` layout.

## "No lint units found"

gimme-the-lint found no package manifests (`package.json`, `pyproject.toml`,
`go.mod`, `Cargo.toml`, `biome.json`). Either the repo has none, or they are
all under directories matched by `skipPatterns` / ignored dirs. Add an explicit
`apps` map to `gimme-the-lint.config.js` if your layout is unusual.

## Every violation is reported as new

The app has no baseline yet (`hasBaseline: false` in the report). Run
`gimme-the-lint baseline` to capture the current violations. This is also the
intended behavior in greenfield mode (`init --no-baseline`).

## A new violation is not being caught

- Confirm the file is **staged** — `check` lints staged files; use `--all` to
  lint everything.
- Confirm the app's linter is installed (see the SKIPPED section above).
- The violation may share a fingerprint (`file + rule + message`) with a
  baselined one. Identical violations are counted — only counts above the
  baseline are new.

## Offline install fails with "OFFLINE: &lt;linter&gt; not found"

`install --offline` deliberately fails when a present language has no linter —
a silent skip would mask a provisioning bug. Provision the linter on the
workstation image (CodeArtifact / pre-baked AMI) and re-run.

## Pre-commit hook does not run

- Confirm hooks are installed: `gimme-the-lint hooks`, then check
  `.git/hooks/pre-commit`.
- An existing hook is backed up to `.git/hooks/pre-commit.backup.<timestamp>`
  before being replaced; `uninstall` restores it.
- Bypass in an emergency with `git commit --no-verify`.

## Drift warnings after a refactor

Moving apps, changing a linter config, or upgrading a linter all register as
drift. Run `gimme-the-lint baseline` to refresh; the manifest updates and the
warnings clear.

## Baselines conflict in a merge

`.gtl/` is committed and team-shared. On a merge conflict in a baseline file,
take either side and run `gimme-the-lint baseline` to regenerate cleanly.

## Reset everything

Delete `.gtl/` and run `gimme-the-lint baseline` to rebuild from scratch.
