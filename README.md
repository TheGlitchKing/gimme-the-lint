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

**v2.0** generalized that idea to any linter and any language — a progressive-lint
**engine** with a pluggable adapter per tool, across JavaScript/TypeScript, Python,
Go, Rust, Terraform and Ansible, in any monorepo shape.

**v2.6** applies the same bargain to a different question. Not *"is this code
well-formed?"* but ***"does your data model agree with the schemas that expose it?"***

Because that is where the expensive bugs live, and they are all silent:

> A user fills in twelve fields. Four are saved. The API returns **201**.
>
> Nobody clicks Save on a project and expects every line item to be reset to
> `pending` and its notes wiped. The endpoint returned **200**.
>
> A column is typed `str` in the response and `JSON` in the database. Harmless —
> until the first *correct* value is written, and every read 500s.

None of that is a lint error. Nothing is malformed, nothing crashes, and the response
says success. **gimme-the-lint now catches it before it ships**, on the same
"only-new-violations-block" terms as everything else — with one exception: a bug that is
*already breaking production* is never grandfathered.

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
| SQL migrations | `squawk` | a `migrations/` directory (any language) |
| Protobuf | `buf`, `buf-breaking` | `*.proto` files |
| OpenAPI / AsyncAPI | `spectral` | `openapi.yaml`, `asyncapi.yaml` |
| TypeScript (types) | `tsc` | `tsconfig.json` |
| Python (types) | `mypy` | a mypy config (`mypy.ini` or `[tool.mypy]`) |

### Type checkers (v2.8)

`tsc` and `mypy` are the two biggest static-analysis surfaces most repos have, and the
classic "we can't turn it on, there are 800 existing errors" problem — which is exactly
what a baseline is for.

They differ from every other adapter in one way: **they ignore the staged-file list and
always check the whole program.** They have to. The type of an expression in one file
depends on declarations in another, so a change in `a.ts` produces errors in `b.ts` —
files your commit never touched. Checked per-file, that breakage reports clean and
reaches the base branch with a green tick. Checked whole-program, it blocks.

That costs seconds rather than milliseconds, so both run at **push**, not on every commit.

Their violations are also identified differently. A type checker *names the types* in its
message — `Argument of type 'Prospect' is not assignable to parameter of type 'Lead'` — so
renaming a type rewrites hundreds of messages at once. Keyed on the message, a pure rename
would retire every baselined fingerprint and introduce an equal number of new ones,
blocking a refactor that changed no behavior. So identity is the *shape* of the error with
the type names redacted, which survives the rename while still telling two different errors
apart.

## Contract checks (v2.6)

Beyond "is this code well-formed": **does your data model agree with the schemas that
expose it?**

| Check | Asks | Runs on |
|-------|------|---------|
| `contract` | Does every column your model has actually reach a client — and come back? | **push** |
| `openapi` | Does your published API contract still describe what your code serves? | **push** |
| `codegen-drift` | Do your frontend's types still match the API they're typed against? | commit |
| `squawk` | Will this migration take a table-locking hold on production? | commit |
| `buf-breaking` | Did this commit break somebody's protobuf client? | push |
| `alembic-check` | Did you change a model and forget to generate a migration? | **CI only** |

### The whole chain, guarded

```
   Postgres columns
        ⇕   alembic-check
   SQLAlchemy models
        ⇕   17 contract rules
   Pydantic schemas
        ↓   materialize → openapi.json
   openapi.json
        ↓   openapi-typescript → api-types.ts
   frontend types
```

**Drift lives wherever two artifacts must _agree_. It cannot exist where one is
_derived_.** So the bottom two rungs are derived, and the class of bug that lived there is
now inexpressible rather than merely tested-for.

The bug that motivated it: a component read `prospect.zip`; the API returns `zip_code`.
Backend correct, contract check green, lockfile fresh, database row right — and a user saw
a blank field for a full release cycle, because `undefined` renders as nothing, and
nothing looks exactly like data that was never saved.

Seventeen contract rules, **each one standing on a specific production bug** — the
incident is recorded with the rule and printed by `gtl-contract rules`. A rule whose
reason is written down is a rule nobody deletes in a hurry.

```bash
gimme-the-lint materialize   # write down the API contract FastAPI only computes at runtime
gimme-the-lint verify        # the checks that need a database (CI only — never a git hook)
```

**Debt is grandfathered; defects are not.** A missing column on a write schema is debt —
baseline it, fix it at your own pace. A response field that 500s every read is a
**defect**: it cannot be baselined, because grandfathering it means writing down *"we
accept that this endpoint is broken."* You can still except it — in config, with a
mandatory reason. The friction is the feature.

Start with [`.documentation/api/contract-guide.md`](.documentation/api/contract-guide.md).

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
[`.documentation/standards/lint-rules-guide.md`](.documentation/standards/lint-rules-guide.md).

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
| `gimme-the-lint check --json` | Full finding list as JSON on stdout, untruncated (triage, agents, CI summaries) |
| `gimme-the-lint check --stage=push` | Also run the slower whole-app checks (the contract engine) |
| `gimme-the-lint materialize` | Write down the API contract your code computes at runtime |
| `gimme-the-lint verify` | Run the checks that need a database (CI only — never a git hook) |
| `gimme-the-lint dashboard` | Per-app baseline status + drift |
| `gimme-the-lint migrate` | Migrate a v1 (`.lttf`) project to the v2 `.gtl/` layout |
| `gimme-the-lint hooks` | Install pre-commit and pre-push git hooks (honors `core.hooksPath`) |
| `gimme-the-lint hooks --print pre-push` | Print a snippet to embed in a hook you already own |
| `gimme-the-lint status` | Overall plugin status |
| `gimme-the-lint uninstall` | Remove hooks and config |

Wiring the Python contract checker into CI **directly** (because the check imports your
app, and your Python runner may not have Node)? `gtl-contract check` reports findings on
stdout and **exits 0 even when it finds violations** — pass `--exit-code` to get a status
you can gate on (`3` = found violations; `1` stays "could not check"). See
[`.documentation/api/contract-guide.md`](.documentation/api/contract-guide.md#running-gtl-contract-directly-and-its-exit-codes).

> **Upgrading from v2.5?** Re-run `gimme-the-lint hooks`, or the new checks silently
> never fire. See [`.documentation/procedures/upgrade-guide.md`](.documentation/procedures/upgrade-guide.md)
> — it carries the full error catalog.

> **Does your repo set `core.hooksPath`?** Re-run `gimme-the-lint hooks`. Every release
> before 2.8.2 wrote into `.git/hooks` regardless — a directory git never opens once
> `core.hooksPath` is set — and then reported them installed. `status` now prints the
> directory it actually read, and flags the leftovers. Repos that already own their hook
> files should compose with `hooks --print` rather than surrender the file; see
> [`.documentation/procedures/git-hooks-guide.md`](.documentation/procedures/git-hooks-guide.md).

---

## Configuration

Zero config is the default — apps and their linters are auto-detected. To
override, add a config file. The canonical location is **`.gtl/config.js`**
(it travels with the committed `.gtl/` baselines); a repo-root
`gimme-the-lint.config.js` is also read, for back-compatibility. `install` and
`migrate` write new configs to `.gtl/`:

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
- uses: TheGlitchKing/gimme-the-lint@v2.6.0
  with:
    mode: full          # 'full' or 'progressive'
    fix: false
    strict: false
    verify: false       # also run the checks that need a database (CI only)
    comment-on-pr: true
```

A ready-to-copy workflow lives at
[`templates/lint.workflow.template.yml`](templates/lint.workflow.template.yml).

> **Pin a version.** A floating `@v2` tag is only safe if it exists — and until
> v2.6.0 it did not, so every workflow copied from the old template failed with
> `unable to find version v2`. `@v2` now exists and moves with each 2.x release; if
> you would rather not track a moving tag, pin the exact one as above.

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
