---
title: How To Use
tier: guide
domains:
  - quickstart
status: active
last_updated: 2026-07-13T00:00:00.000Z
version: 2.7.0
word_count: 617
estimated_read_time: 4 minutes
last_validated: 2026-07-13
---

# How to Use gimme-the-lint

## Quick start

```bash
gimme-the-lint install      # write configs + set up the project
gimme-the-lint baseline     # capture existing violations
gimme-the-lint hooks        # install git hooks
```

Commit the `.gtl/` directory so the whole team shares the baseline.

## The core loop

1. **Baseline** — `gimme-the-lint baseline` lints every app and records its
   current violations as fingerprints under `.gtl/apps/<app>/baseline.json`.
2. **Check** — `gimme-the-lint check` lints staged files and compares against
   the baseline. Only violations not in the baseline block the commit.
3. **Fix** — `gimme-the-lint check --fix` auto-fixes what the linter can; fix
   the rest by hand, re-stage, and retry.

## Commands

| Command | What it does |
|---------|--------------|
| `check` | Lint staged files; block on new violations |
| `check --all` | Lint every app, not just staged changes |
| `check --fix` | Auto-fix where the linter supports it |
| `check --strict` | Fail if a linter is missing for present code |
| `check --json` | Full finding list as JSON on stdout, untruncated |
| `baseline` | Capture/refresh baselines for every app |
| `baseline --empty` | Write empty baselines (greenfield) |
| `dashboard` | Per-app baseline status + drift |
| `migrate` | Migrate a v1 (`.lttf`) project to the v2 `.gtl/` layout |
| `hooks` | Install pre-commit + pre-push hooks |
| `status` | Overall plugin status |

## Triaging a first run: `--json`

The terminal report truncates each app's list at 20 findings (`…and 272 more`). That is
right for a commit hook and wrong for adoption day, when the question is not *how many*
but **what shape** — 137 findings is either "137 real bugs" or "137 missing exemptions",
and those demand opposite responses.

```bash
gimme-the-lint check --all --stage=push --json > findings.json
```

Stdout carries **JSON and only JSON**, untruncated. Diagnostics go to stderr.

```bash
# what kind of findings are these?
jq -r '.violations[].ruleId' findings.json | sort | uniq -c | sort -rn

# which are defects, and so can never be baselined?
jq -r '.violations[] | select(.neverBaseline) | "\(.app) \(.ruleId) \(.file)"' findings.json
```

### Read `allChecked`, not just `ok`

They are two different facts and the format keeps them apart on purpose:

| field | means |
|---|---|
| `ok` | Nothing **new** blocked. Mirrors the exit code. |
| `allChecked` | Every adapter actually ran. **False if anything was skipped.** |
| `skipped[]` | One entry per adapter that could not look, with the reason. |

A run in which every linter was missing is `ok: true`, exit 0 — exactly as it is on the
terminal. On a terminal a skip is a yellow `⚠` a human notices; **in JSON there is
nothing to notice**, so a consumer reading only `ok` would read "we could not look at
anything" as a clean bill of health. **Check `allChecked` in CI**, not just `ok`:

```bash
jq -e '.allChecked' findings.json || echo "something could not be checked — see .skipped[]"
```

Or let the tool do it: `gimme-the-lint check --fail-on-skip` (see below).

> `--format json` does not exist and never has — the flag is `--json`. If you tried the
> other one, commander wrote `unknown option` to **stderr** while you were watching
> stdout, which is why it looked like it silently produced nothing.

## How violations are matched

A violation's identity is `file + rule + message` — **not** its line number.
So when code moves up or down a file, its baselined violations move with it and
stay suppressed. Only a genuinely new problem is flagged. Duplicate violations
are counted: if a file had one baselined `no-unused-vars` and now has two, one
is new.

## The per-app model

gimme-the-lint walks the repo and binds each package to its linter:

| Manifest | Linter |
|----------|--------|
| `package.json` | `eslint` |
| `biome.json` | `biome` (supersedes ESLint for that app) |
| `pyproject.toml` / `requirements.txt` | `ruff` |
| `go.mod` | `golangci-lint` |
| `Cargo.toml` | `clippy` |
| `*.tf` / `*.tofu` files | `tflint` |
| `ansible.cfg` / `galaxy.yml` | `ansible-lint` |

Each app gets its own `.gtl/apps/<app>/baseline.json`. Drift is per app — a
config or linter-version change in one app never churns another's baseline.

Terraform / OpenTofu is the one exception to manifest binding: it has no
manifest file, so a directory containing `*.tf` / `*.tofu` source *is* the unit.
When `.tf` files sit at the repo root **and** in `modules/*/`, the root is
treated as a workspace root and only the leaf modules are linted — bind `.`
explicitly in `gimme-the-lint.config.js` to lint a root module. See the
installation guide's "Terraform / OpenTofu app discovery" section for detail.

## Shipped lint configs

`install` seeds each app with a best-practice config for its linter
(`eslint.config.js`, `biome.json`, `pyproject.toml`, `.golangci.yml`,
`clippy.toml` + `Cargo.toml` `[lints.clippy]`, `.tflint.hcl`) plus a repo-root
`.gitleaks.toml`. Configs are **created only if absent** — your own config is
never overwritten. Every shipped config includes a security rule layer; secret
detection is universal via gitleaks and always blocks. See the **Lint Rules
Guide** for the baseline rules per codebase and how to adjust them.

## Configuration

Auto-detection needs no config. To override, add `.gtl/config.js` (the
canonical location — a repo-root `gimme-the-lint.config.js` is still read for
back-compatibility):

```js
module.exports = {
  apps: {
    'apps/orders-api':    { linters: ['eslint'] },
    'apps/orders-worker': { linters: ['ruff'] },
  },
  skipPatterns: ['_template-*'],
};
```

## Idempotent skips

- No code for a language → silent no-op.
- Code present but the linter is not installed → loud `⚠ SKIPPED (NOT CHECKED)`; the
  commit still proceeds, and the gap is recorded.
- `--strict` turns that skip into a hard failure.

### A skip is not a pass — especially in CI

A skip means **unverified**, and it does not fail the run. On a terminal that is fine:
a human sees the yellow line. In a CI log the warning scrolls past and the job goes
green, so the contract was never checked and the PR shows a green tick.

It is easy to land in by accident. An explicit `apps` map bypasses auto-discovery, so an
adapter never binds; and the contract check **imports your application**, so it needs the
app's Python dependencies and import-time env — which a typical `lint` job has neither of.
Both produce a skip, and neither is visible on a green build.

```bash
gimme-the-lint check --all --stage=push --fail-on-skip
```

**Opt-in, deliberately.** Turning it on by default would redden builds that were already
skipping yesterday, for a condition nobody introduced — the same reasoning that keeps
`--no-stale-baseline` opt-in. A flag that reddens CI on a minor upgrade is a flag people
remove rather than fix.

Three statuses count as "did not run", not just the obvious one:

| status | meaning |
|---|---|
| `skipped` | the linter, or the app, could not be reached |
| `error` | the adapter itself failed |
| `needs-baseline` | there was nothing to diff against |

All three produce **zero violations**, and none of them is a clean bill of health.

In the GitHub Action, set `fail-on-skip: true`. Either way the action now annotates every
skip as a `::warning::` and names them in the PR comment, so a green tick cannot quietly
mean "we did not look."

## Drift

`gimme-the-lint dashboard` reports drift since the last baseline: apps added or
removed, a linter config changed, a linter version changed, or a baseline older
than 30 days. Run `gimme-the-lint baseline` to refresh.

## Claude Code

`/lint` runs a check, `/lint:status` shows the dashboard, `/lint:baseline`
refreshes baselines. When a commit is blocked, the hook output instructs Claude
Code to run `check --fix`, re-stage, and retry automatically.

---

## v2.6: the contract commands

```bash
gimme-the-lint check --stage=push   # + the whole-app contract checks
gimme-the-lint materialize          # write down the API contract (openapi.json)
gimme-the-lint verify               # checks needing a database — CI only, never a hook
```

**Why `--stage`:** the contract check imports your application (seconds). That is fine
once per push and intolerable on every commit — a slow commit hook is a hook people
disable. `pre-commit` runs `--stage=commit`; `pre-push` runs `--stage=push`.

**If you upgraded from v2.5, re-run `gimme-the-lint hooks`** — old hook files pass no
`--stage`, so the new checks silently never fire.

See [`contract-guide.md`](../api/contract-guide.md) and
[`upgrade-guide.md`](../procedures/upgrade-guide.md).
