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
| `baseline` | Capture/refresh baselines for every app |
| `baseline --empty` | Write empty baselines (greenfield) |
| `dashboard` | Per-app baseline status + drift |
| `migrate` | Migrate a v1 (`.lttf`) project to the v2 `.gtl/` layout |
| `hooks` | Install pre-commit + pre-push hooks |
| `status` | Overall plugin status |

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

Each app gets its own `.gtl/apps/<app>/baseline.json`. Drift is per app — a
config or linter-version change in one app never churns another's baseline.

## Configuration

Auto-detection needs no config. To override, add `gimme-the-lint.config.js`:

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
- Code present but the linter is not installed → loud `⚠ SKIPPED`; the commit
  still proceeds, and the gap is recorded.
- `--strict` turns that skip into a hard failure.

## Drift

`gimme-the-lint dashboard` reports drift since the last baseline: apps added or
removed, a linter config changed, a linter version changed, or a baseline older
than 30 days. Run `gimme-the-lint baseline` to refresh.

## Claude Code

`/lint` runs a check, `/lint:status` shows the dashboard, `/lint:baseline`
refreshes baselines. When a commit is blocked, the hook output instructs Claude
Code to run `check --fix`, re-stage, and retry automatically.
