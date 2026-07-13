---
title: Troubleshooting
tier: guide
domains:
  - troubleshooting
status: active
last_updated: 2026-07-13T00:00:00.000Z
version: 2.7.0
word_count: 721
estimated_read_time: 4 minutes
last_validated: 2026-07-13
---

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
- Terraform: install `tflint`
- Ansible: `pip install ansible-lint`

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

## ESLint config errors: "Cannot find package 'eslint-plugin-security'"

The seeded `eslint.config.js` imports security and Prettier plugins. Install
them in the target project:

```bash
npm install --save-dev eslint-plugin-security eslint-plugin-no-secrets \
  eslint-config-prettier prettier
```

See the Lint Rules Guide for the full ESLint dev-dependency list.

## `install` did not seed a `biome.json` / `pyproject.toml`

Biome and Ruff are *detected by* their config file, so a discovered app already
has one and `install` reports it as `exists` rather than overwriting it. To
apply gimme-the-lint's baseline rules, copy the `[tool.ruff*]` tables (or the
`biome.json` contents) from the `templates/` directory of the installed
package, or re-run with `--force`.

## Clippy `[lints.clippy]` was not added to `Cargo.toml`

`install` appends the `[lints.clippy]` table only if `Cargo.toml` has no
`[lints]` (or `[workspace.lints]`) table already. If one exists, merge the block
from `templates/clippy-cargo-lints.template.toml` yourself. For a workspace, the
table belongs in the root `Cargo.toml` under `[workspace.lints.clippy]`.

## `migrate` / `baseline` exited non-zero — "baseline is INCOMPLETE"

A linter that applies to an app could not run — it is not installed
(`unavailable`) or it errored. That linter was **not** baselined, so gating
commits against the baseline would flag every pre-existing violation as new.
`migrate` and `baseline` now fail loudly instead of reporting a false success.

Fix it: install the missing linter(s) named in the summary, then re-run
`gimme-the-lint baseline`. To accept an incomplete baseline deliberately, pass
`--allow-incomplete`.

## `hooks` refuses to install — "the baseline is incomplete"

Same cause: some linters were never baselined. Installing hooks would gate
commits against an incomplete baseline. Install the missing linters and re-run
`gimme-the-lint baseline`, or pass `gimme-the-lint hooks --force` to install
anyway (and re-baseline as soon as the linters are available).

## `check` reports "NEEDS BASELINE"

The baseline for that linter was captured while the linter was unavailable, so
it is incomplete. Now that the linter runs, re-capture it: `gimme-the-lint
baseline`. `check` deliberately warns rather than flooding the run with "new"
violations.

## Reset everything

Delete `.gtl/` and run `gimme-the-lint baseline` to rebuild from scratch.

---

## Contract checks won't run?

The entity-contract check imports your application, which gives it its own failure modes
(a missing env var, a model that connects at import, a venv that isn't there). They are
all recoverable, and they all resolve to a loud skip that never blocks.

See [`contract-troubleshooting-guide.md`](contract-troubleshooting-guide.md).

**The rule that governs all of them:** a skip means **UNCHECKED**, not **CLEAN**.
