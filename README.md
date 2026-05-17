# gimme-the-lint

[![npm version](https://img.shields.io/npm/v/@theglitchking/gimme-the-lint.svg)](https://www.npmjs.com/package/@theglitchking/gimme-the-lint)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Action](https://github.com/TheGlitchKing/gimme-the-lint/workflows/Progressive%20Lint/badge.svg)](https://github.com/TheGlitchKing/gimme-the-lint/actions)

---

## Summary

Most projects use linters to catch mistakes and keep code clean. The problem is
that when you add a linter to a project that already has a lot of code, the
linter finds hundreds — sometimes thousands — of old problems. Turning linting
on would block every commit until someone fixes all of it, so teams just never
do it. **gimme-the-lint** solves this by remembering the old problems and only
blocking your work when you create a _new_ one. Your team cleans up the old
stuff at its own pace; meanwhile no new mess gets in.

**v2.0** generalizes that idea to any linter and any language. It is no longer
"ESLint + Ruff for webapps" — it is a progressive-lint **engine** with a
pluggable **linter adapter** for each tool, across **JavaScript/TypeScript, Python,
Go, Rust, Terraform, and Ansible**, in **any monorepo shape**.

---

## How it works

gimme-the-lint creates **baselines** — snapshots of every existing violation,
stored per app under `.gtl/`. On each run it lints, then asks one question of
every violation: _is this new, or was it already baselined?_ Only new violations
block.

The trick is the **fingerprint**. Each violation is identified by
`file + rule + message` — deliberately **not** by line number. So a baselined
violation survives code moving up or down a file; only a genuinely new problem
is ever flagged. (In v1 this job was outsourced to the third-party
`lint-to-the-future`; v2 owns it, which is what makes every linter equal.)

Each app is bound to the linters its package manifest implies — `package.json`
→ ESLint, `pyproject.toml` → Ruff, `go.mod` → golangci-lint, `Cargo.toml` →
Clippy, `biome.json` → Biome, `ansible.cfg` / `galaxy.yml` → ansible-lint.
Terraform has no manifest, so a directory of `*.tf` / `*.tofu` files binds to
tflint by extension. Drift detection runs per app, so a config or linter-version
change in one app never churns the baselines of another.

---

## Features

- **Progressive linting** — only new violations block; existing ones are baselined
- **In-house diff engine** — line/column-independent fingerprints survive code shifts
- **Pluggable linter adapters** — the choice of linter is config, not a hardcode
- **Polyglot** — JavaScript/TypeScript, Python, Go, Rust, Terraform, Ansible out of the box
- **Per-app model** — auto-discovers every package in a monorepo; no `frontend/`
  + `backend/` assumption
- **Per-app drift detection** — app add/remove, config change, linter version, age
- **Best-practice configs shipped** — `install` seeds each app with a curated,
  security-aware config for its linter (create-if-absent — never clobbers yours)
- **Security linting built in** — gitleaks for secrets across every codebase,
  plus per-language security rules (gosec, Ruff `S`, eslint-plugin-security)
- **Idempotent skips** — an app with code but no installed linter is warn-skipped
  (never blocks) — or fails loudly under `--strict`
- **Offline install** — air-gapped mode for regulated environments
- **Greenfield mode** — "strict from day one" with empty baselines
- **Git hooks, CLI, GitHub Action, Claude Code plugin** — one engine, four front doors
- **LLM-optimized output** — failures tell Claude Code to auto-fix without asking

## Supported linters

| Language | Linter | Bound by |
|----------|--------|----------|
| JavaScript / TypeScript | `eslint` | `package.json` |
| JavaScript / TypeScript | `biome` | `biome.json` (supersedes ESLint) |
| Python | `ruff` | `pyproject.toml`, `requirements.txt`, `setup.py` |
| Go | `golangci-lint` | `go.mod` |
| Rust | `clippy` (`cargo clippy`) | `Cargo.toml` |
| Terraform / OpenTofu | `tflint` | `*.tf` / `*.tofu` files (no manifest) |
| Ansible | `ansible-lint` | `ansible.cfg`, `galaxy.yml` |

## Shipped lint configs

`install` seeds every discovered app with a best-practice ("recommended" tier)
config for its linter — **created only if absent**, so your own config is never
overwritten. Each ships a sensible default rule set and a single **lever** to
dial strictness up or down:

| Codebase | Linter | Default rules (recommended tier) | Strictness lever |
|----------|--------|----------------------------------|------------------|
| JS/TS | ESLint | `@eslint/js` + React recommended, import-architecture guards, security plugins, Prettier-compatible | rules block in `eslint.config.js` |
| JS/TS | Biome | recommended set + full `security` group + console/complexity rules | rule levels in `biome.json` |
| Python | Ruff | pyflakes / pycodestyle / isort / bugbear / pyupgrade + `S` security + comprehensions / simplify | `select` / `ignore` in `pyproject.toml` |
| Go | golangci-lint | `standard` set + correctness & quality linters + `gosec` | `linters.enable` in `.golangci.yml` |
| Rust | Clippy | `pedantic` + `cargo` at `warn`, noisy lints allowed back | `[lints.clippy]` levels in `Cargo.toml` |
| Terraform | tflint | bundled `terraform` ruleset, `recommended` preset | `preset` in `.tflint.hcl` (`recommended` → `all`) |
| Ansible | ansible-lint | `moderate` profile | `profile` in `.ansible-lint` (`min` → `production`) |
| Secrets (all) | gitleaks | default ruleset + key / password rules — **always blocks** | `[allowlist]` in `.gitleaks.toml` |

Every shipped config carries a **security layer**. gitleaks scans every file in
every codebase for secrets (passwords, SSL/private keys, tokens) and always
blocks — secrets are never baselined. Each linter adds language-specific
security rules on top (`gosec`, Ruff `S` / flake8-bandit, `eslint-plugin-security`,
Biome's `security` group), which follow normal progressive baselining.

To go stricter, pull the lever in the table above — because violations are
progressively baselined, raising strictness never blocks existing code, only new
code is held to the higher bar. Full per-codebase detail — every default rule
and how to adjust it — is in
[`.documentation/lint-rules-guide.md`](.documentation/lint-rules-guide.md).

---

## Quick Start

### Install

```bash
# Local (recommended — every teammate gets it on clone)
npm install --save-dev @theglitchking/gimme-the-lint
npx gimme-the-lint install

# Global
npm install -g @theglitchking/gimme-the-lint
gimme-the-lint install

# Claude Code plugin
/plugin install TheGlitchKing/gimme-the-lint
```

### First-time setup on an existing project

```bash
npx gimme-the-lint install      # writes configs + git hooks
npx gimme-the-lint baseline     # captures existing violations as baselines
npx gimme-the-lint dashboard    # see what is baselined and any drift
```

From here, every commit is linted — but only your **new** code is held to the
rules. Commit the `.gtl/` directory so the whole team shares the baseline.

### Day to day

The pre-commit hook fires on `git commit`. If you introduced a new violation it
blocks the commit and shows exactly what to fix:

```bash
gimme-the-lint check --fix      # auto-fix what the linter can
git add -A && git commit -m "…" # retry
```

---

## CLI

| Command | Description |
|---------|-------------|
| `gimme-the-lint install` | Write configs and set up the project |
| `gimme-the-lint install --offline` | Air-gapped install — no npm/pip fetches |
| `gimme-the-lint install --no-baseline` | Greenfield — empty baselines, strict from day one |
| `gimme-the-lint baseline` | Capture/refresh baselines for every app |
| `gimme-the-lint baseline --empty` | Write empty baselines (greenfield) |
| `gimme-the-lint check` | Lint files staged for commit |
| `gimme-the-lint check --all` | Lint every app, not just staged changes |
| `gimme-the-lint check --fix` | Auto-fix where the linter supports it |
| `gimme-the-lint check --strict` | Fail if a linter is missing for present code |
| `gimme-the-lint dashboard` | Per-app baseline status + drift |
| `gimme-the-lint migrate` | Migrate a v1 (`.lttf`) project to the v2 `.gtl/` layout |
| `gimme-the-lint hooks` | Install pre-commit and pre-push git hooks |
| `gimme-the-lint status` | Overall plugin status |
| `gimme-the-lint uninstall` | Remove hooks and config |

---

## Configuration

Zero config is the default — apps and their linters are auto-detected. To
override, add `gimme-the-lint.config.js` at the repo root:

```js
module.exports = {
  // Explicit per-app linter binding (omit `apps` entirely to auto-detect).
  apps: {
    'apps/orders-api':    { linters: ['eslint'] },
    'apps/orders-worker': { linters: ['ruff'] },
    'apps/billing-events':{ linters: ['golangci-lint'] },
    'apps/audit-stream':  { linters: ['clippy'] },
  },
  // Directories to skip (template/scaffold dirs are skipped by convention).
  skipPatterns: ['_template-*', '__template__'],
};
```

### Polyglot monorepos

A modern monorepo is not one frontend and one backend:

```
apps/
├── orders-api/        package.json   → eslint
├── orders-worker/     pyproject.toml → ruff
├── billing-events/    go.mod         → golangci-lint
└── audit-stream/      Cargo.toml     → clippy
```

`gimme-the-lint baseline` discovers all four, binds each to its linter, and
writes `.gtl/apps/<app>/baseline.json` per app. Workspace files
(`pnpm-workspace.yaml`, `nx.json`, `lerna.json`) need no special handling —
each package carries its own manifest, so discovery just works.

### I use Biome — can I use this?

Yes. Drop a `biome.json` in an app and gimme-the-lint binds that app to Biome
instead of ESLint — no running both, no doubled CI time, no config conflict.
Biome's JSON reporter is parsed like any other adapter. (Biome locates
diagnostics by byte span, not line number; that is fine — fingerprints exclude
position by design.) The linter is config, not a hardcode: ESLint, Biome,
Ruff, golangci-lint and Clippy are all just adapters.

### Idempotent skips

A language is never a hard prerequisite:

- **No code** for a language → silent no-op.
- **Code present, linter not installed** → loud `⚠ SKIPPED` warning; the commit
  still goes through, and the gap is recorded in the manifest.
- Under `--strict` (and in `--offline` installs) that same case **fails loudly**
  — a silent skip there would hide a provisioning bug.

---

## Adoption modes

**Air-gapped / regulated environments** — `install --offline` performs no
network fetches, assumes the linter toolchain is provisioned by your image, and
fails loudly if a present language has no linter:

```bash
gimme-the-lint install --offline
```

**Greenfield / new repos** — there is no legacy debt to grandfather, so
`init --no-baseline` writes empty baselines and installs hooks: every violation
counts as new, "strict from day one":

```bash
gimme-the-lint init --no-baseline
```

---

## Migrating from v1

v2 changes the baseline layout (`.lttf/` + `.lttf-ruff/` → `.gtl/`), the
baseline format, and the config schema. One command handles it:

```bash
gimme-the-lint migrate
```

It backs the legacy directories up under `.gtl/legacy-backup/<timestamp>/`,
then re-baselines from the current code into the v2 layout. `check` also
detects an un-migrated v1 project and prints the same hint. See
[CHANGELOG.md](CHANGELOG.md) for the full list of breaking changes.

---

## Claude Code

| Command | Description |
|---------|-------------|
| `/lint` | Run progressive linting on the project |
| `/lint:status` | Show the dashboard (per-app baselines + drift) |
| `/lint:baseline` | Create or refresh baselines |

When a commit Claude makes is blocked by the pre-commit hook, the hook output
includes LLM instructions: Claude auto-runs `check --fix`, re-stages, and
retries — only asking you if violations remain after auto-fix.

## GitHub Action

```yaml
- uses: TheGlitchKing/gimme-the-lint@v2
  with:
    mode: full          # 'full' or 'progressive'
    fix: false
    strict: false
    comment-on-pr: true
```

A ready-to-copy workflow lives at
[`.github/workflows/lint.template.yml`](.github/workflows/lint.template.yml).

---

## Architecture

```
lib/
├── violation.js        NormalizedViolation — the linter-agnostic currency
├── fingerprint.js      line/column-independent violation identity
├── diff-engine.js      pure diff: new vs baselined vs fixed
├── baseline-store.js   one baseline.json format for every linter
├── adapters/           one adapter per linter (eslint, biome, ruff,
│                       golangci-lint, clippy, tflint, ansible-lint)
│                       + the base contract
├── project-model.js    discovers apps + binds them to linters
├── units.js            resolves apps → {dir, linters, baseline path}
├── check.js            runCheck: lint → diff → report
├── baseline.js         runBaseline: capture violations into .gtl/
├── gtl-manifest.js     global .gtl/manifest.json
├── drift.js            per-app drift detection
├── toolchain.js        per-language linter availability
├── migrate.js          v1 → v2 migration
└── dashboard.js, report.js, installer.js, …
```

The engine is pure and fully unit-tested; adapters wrap real linters; the CLI,
git hooks, GitHub Action and Claude Code plugin are thin front doors over it.

## Requirements

- **Node.js** >= 20
- **Git** (for hooks and staged-file detection)
- A linter for each language you use (`eslint`/`biome`, `ruff`, `golangci-lint`,
  `clippy`, `tflint`, `ansible-lint`) — any language whose linter is absent is
  simply skipped

## License

MIT — see [LICENSE](LICENSE)
