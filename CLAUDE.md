# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Priority-0 rules live in `.claude/rules/` and override convenience, style, and velocity.**
> Every `.md` file there is auto-loaded at session start (recursively, same priority as this
> file) — so they are already in context; this note is for humans reading CLAUDE.md, not a
> load mechanism. Do **not** `@`-import them here: that loads them twice.
> Adding a rule = adding a file. Verify a session actually loaded them with `/context`.

## What this is

`gimme-the-lint` **manages lint violations and data-model/schema drift, progressively**:
it baselines what already exists so only *new* findings block. Two co-equal domains, one
bargain — **lint** ("is this code well-formed?", any linter, any language) and
**contract** ("does the data model agree with the schemas that expose it?", v2.6+).
Contract checking is younger, not lesser; anything true of one half is presumed true of
the other. Rationale: `.documentation/standards/principles-guide.md`.

This repo is the tool itself, not a consumer of it. Two artifacts ship as one package:

```
gimme-the-lint  (npm, Node, lib/)      gtl-contract  (Python, python/)
├── the engine: fingerprint /          ├── the introspector: walks the ORM
│   diff / baseline / drift            │   registry, reads the route table
├── 17 adapters (one per linter)       ├── 21 rules, each carrying the
│   contract.js ──── shells to ───────→│   production incident it stands on
└── CLI, git hooks, GH Action,         └── prints violations as JSON
    Claude Code plugin
```

`python/` ships **inside the npm tarball** and is pip-installed from the local path — not
from PyPI. That is deliberate: air-gapped installs need no network, and the adapter and
checker sharing a JSON wire format can never version-skew if they are one artifact.
`gtl_contract` declares **no runtime dependencies** — it inspects *the user's* SQLAlchemy
and Pydantic, at the versions their app already pins.

## Commands

```bash
npm test                      # node tests + python tests
npm run test:contract         # node only: node --test tests/*.test.js
node --test tests/drift.test.js   # a single node test file
npm run setup:python          # create python/.venv and pip install -e 'python/[dev]'
npm run test:python           # pytest python/tests -q (via python/.venv)
python/.venv/bin/pytest python/tests/test_rules.py -q   # a single python test file

node ./bin/gimme-the-lint.js check --all   # run the tool against this repo
python/.venv/bin/gtl-contract rules        # the rule catalogue, as JSON
```

There is no build step and no JS linter configured for this repo's own source.

CI (`.github/workflows/ci.yml`) runs Node 20/22/24, Python 3.11/3.12/3.13, a docs audit
(`hewtd audit`, `hewtd link-check`, `scripts/verify-facts.py`), and a **packaging job** that
`npm pack`s the tarball, pip-installs the extracted `python/`, and asserts the shipped
`gtl-contract` lists ≥17 rules and that no test fixtures leaked into the tarball. Two real
packaging bugs were caught only by that job — changes to `files`/`.npmignore` in
`package.json` must keep it green.

## The pipeline

`bin/gimme-the-lint.js` is a thin Commander wrapper; every subcommand delegates to one
`lib/*.js` module. `runCheck()` (`lib/check.js:175`) is the core loop:

1. **`resolveUnits(root)`** (`lib/units.js:37`) — explicit `apps` from config, else
   `projectModel.discoverApps()` (`lib/project-model.js:264`), which walks the tree binding
   each manifest to its linter (`MANIFEST_LINTERS`, `lib/project-model.js:19` —
   `package.json`→eslint, `pyproject.toml`→ruff, `go.mod`→golangci-lint …), plus
   extension-based discovery for Terraform/proto/OpenAPI. Each unit gets
   `.gtl/apps/<app>/baseline.json`.
2. **`adapters.getAdapter(id, {projectRoot, appRoot})`** (`lib/adapters/index.js:70`).
3. **`checkUnit()`** (`lib/check.js:70`) gates: external-tier adapters are refused outright,
   wrong-stage adapters skipped, then `detect()`/`available()` separate "no code" from
   "linter missing", then `adapter.lint()` returns `NormalizedViolation[]`.
4. **`diffEngine.diff()`** (`lib/diff-engine.js:52`) against the stored baseline. Only
   `result.new` fails the run.
5. **`formatCheckReport()`** (`lib/report.js`).

`runBaseline()` (`lib/baseline.js:189`) mirrors the same loop but writes baselines and
refreshes the drift manifest.

## Adapters

`LinterAdapter` (`lib/adapters/adapter.js:59`) is the base class. A concrete adapter needs
only `id`, `buildCommand(targets, opts)`, and `parse(stdout, stderr, code)` →
`NormalizedViolation[]`. Process execution, binary/version probing, source detection, and
config resolution (`resolveConfigPath()` walks up from appRoot to projectRoot, so repo-root
configs are honored) are inherited. Optional: `tier`, `stage`, `configFiles()`,
`initCommand()`, `materialize()`, `rulesetVersions()`.

**Adding a linter is one file in `lib/adapters/` plus one line in the `REGISTRY` map**
(`lib/adapters/index.js:23`). Note that registry *order* is load-bearing exactly once:
`materializeOrder()` (`lib/adapters/index.js:106`) derives from it, and `openapi` must
materialize before `codegen-drift`.

**Adding a contract rule** is `python/gtl_contract/rules.py` plus a check in
`providers/*/checks.py`. Rules belong to the provider, exactly as ESLint's rules belong to
ESLint; the engine only ever sees violations.

## The contract engine (`python/gtl_contract/`)

A **provider** (`providers/base.py:63`) binds one persistence layer to one transport layer —
`sqlalchemy_pydantic` ships; django+drf and prisma+zod are the named future candidates.
A provider supplies `id`, `detect(root, config)` (cheap, and **must not import the app**), and
`check(root, config) -> ProviderResult`. The shipped provider *does* import the app rather
than parsing filenames, because unconventionally-named write schemas are exactly the ones a
static scan misses invisibly.

**Skip is not pass.** `ProviderResult` (`providers/base.py:42`) separates
`checked=True, violations=[]` (genuinely clean) from `checked=False, skip="…"` (couldn't
look). Never collapse the two. `python/tests/test_skip_is_not_pass.py` exists solely to
enforce this: a missing model package, an app that raises on import, an empty registry, an
unreadable route table, and absent sqlalchemy/pydantic must *all* report `checked=False` with
a populated reason — never a clean pass. On the JS side `checked===false` maps to
`ADAPTER_SKIPPED`, which the engine turns into a loud warning, never a block.

**The wire protocol.** `contract.js` resolves `gtl-contract` from `appRoot/.venv/bin`, then
`projectRoot/.venv/bin`, then PATH (`lib/venv-manager.js` owns venv creation), writes the
`.gtl/config.js` `contract` block to a temp JSON file (Python never parses JS), and runs
`gtl-contract check --root <cwd> --config <tmp>`. Python emits **exactly one JSON object on
stdout and nothing else** — app-import noise is redirected fd-1→stderr by
`quarantined_stdout()` (`cli.py:36`), so a structlog line firing at import time cannot
corrupt the payload. Exit 0 = checked, 1 = `checked:false` + reason, 2 = misuse. Each
violation's `neverBaseline` is carried **verbatim** from Python; the Node engine holds no
hardcoded defect list.

Python tests check fixture apps under `python/tests/fixtures/` — `brokenapp` is deliberately
full of every violation, `cleanapp` deliberately valid — imported off `sys.path` by the `run()`
helper in `conftest.py:18`.

## Identity: fingerprints

`fingerprint()` (`lib/fingerprint.js:51`) hashes either `[normalizedPath, ruleId,
normalizedMessage]` (default) or `[fingerprintKey, ruleId]` when an adapter can *name the
thing it is complaining about* (`Deal.operating_expenses:writable`). Line and column are
excluded by design so a baselined violation survives code moving within a file.

- **The default scheme is frozen byte-for-byte** and asserted against literal digests in
  `tests/fingerprint.test.js`. Every baseline in every consumer repo is a map keyed by these
  hashes — changing the scheme invalidates all of them.
- `fingerprintKey` exists because schemas get *moved* (a path-keyed baseline would evaporate
  on rename and resurrect every grandfathered finding) and because messages *enumerate sets*
  ("no write schema accepts [a, b]" → "[a, b, c]" is a different string).
- The diff engine compares **counts** per fingerprint, not set membership — duplicating an
  already-grandfathered violation is still caught.
- When an upstream linter renames a rule, record it in `lib/rule-aliases.js` (data, not
  code); `migrate --rules` rewrites stored fingerprints old→new to preserve the grandfather.

## Baselines and drift

`.gtl/apps/<app-or-"root">/baseline.json`, schema at `lib/baseline-store.js:14`:
`{schema, created_at, linters: {<id>: {tool_version, config_hash, status, total,
fingerprints: {sha1: count}}}}`. One file per unit, one section per linter — bumping
eslint's config never invalidates ruff's section. `STATUS` (`lib/baseline-store.js:38`)
distinguishes real results (`baselined`/`clean`) from incomplete ones
(`unavailable`/`error`), and **incomplete is never treated as clean**.

`lib/drift.js:20` compares the global `.gtl/manifest.json` against current `resolveUnits()`
output: apps added/removed, per-app config-hash changes, tool-version changes, ruleset-plugin
versions, plus a 30-day staleness flag.

## The invariants — read these before changing engine behavior

`tests/invariants.test.js` is not a feature suite. Each test guards against a **silent**
failure: a check that quietly stops checking while still reporting success. That is the
disease this tool exists to cure, so it must not be how the tool itself fails. Each was
verified by deliberately breaking the implementation and watching it go red.

- **`check` never mutates the working tree** — in any mode, including `--fix` with no adapter
  installed. **`materialize` is the only command that writes into the tree.**
- **`check` never writes a baseline** — otherwise the guard disarms itself the first time it
  fires.
- **Defect vs debt.** A violation with `neverBaseline` cannot be grandfathered, through
  **three independent gates**: excluded at capture (`lib/baseline-store.js:77`), re-checked
  at diff time (`lib/diff-engine.js:78`), and reported loudly by `baseline`
  (`lib/baseline.js:130`) so a hand-edited baseline file still cannot smuggle one through.
  10 of the 21 contract rules are defects. Users can except them only in config, with a
  mandatory reason — the friction is the feature.
- **Incomplete baselines never gate** — `check` returns `needs-baseline` rather than diffing
  against an empty section.
- **`--stage` defaults to `commit`, and that default is a safety property.** Git hooks are
  installed *files*; upgrading the package does not rewrite a hook installed months ago.
  Stale hooks call `check` with no `--stage`, so the default must make them do **less**,
  never more. The hook carries `gtl-hook-contract: N` in a comment (`githooks/pre-commit`);
  bump it whenever the flags a hook passes change, so `status` can report a stale hook.

**Tier and stage are orthogonal** (`lib/adapters/adapter.js:28`, `:43`). `tier` is what an
adapter *needs*: `local` (files), `reference` (+ git history), `external` (+ a database or
network). An `external` adapter is **structurally** unreachable from `check` — no flag talks
it into running; it fires only from `gimme-the-lint verify`, in CI. `stage` is what it
*costs*: `commit` / `push` / `ci`. A `local` adapter can still be too slow for a commit hook,
which is exactly the contract check's situation (it imports the whole app).

## Two sources of truth

The rule catalogue lives in Python (`python/gtl_contract/rules.py`) but two rules —
`contract/codegen-stale` and `contract/codegen-missing` — are *emitted* by the Node adapter
(`lib/adapters/codegen-drift.js`), which never imports the app. They are catalogued in Python
anyway, because `gtl-contract rules` is the documented answer to "why does this rule exist?"
— what someone reads before disabling a rule that just blocked their push.

These two sides have drifted twice. `tests/codegen-drift.test.js` now runs the adapter for
real and pins every flag it emits against the catalogue; `python/tests/test_rules.py` pins
the defect set. **If you add or reclassify a rule, both pins must be updated deliberately** —
moving a rule across the defect line is a decision, not a typo.

## Documentation

`.documentation/` is managed by `hit-em-with-the-docs`; `INDEX.md` and `REGISTRY.md` are
generated (hand-edits are overwritten, and a hook denies them). Register new docs with
`hewtd integrate <file>`; retire with `hewtd archive <file>` — docs are never deleted, and
anything under `archive/` is historical, never evidence of current behavior.

Knowledge-base facts carry a `verify_command` that CI actually executes
(`scripts/verify-facts.py`) — a fact whose command no longer runs is a rumour with
frontmatter. Rule documentation carries the production incident each rule stands on; a rule
whose reason has rotted is a rule somebody deletes in a hurry.

Start points: `.documentation/architecture/architecture-guide.md`,
`.documentation/api/contract-guide.md`, `.documentation/standards/contract-rules-guide.md`,
`.documentation/standards/decision-vs-debt-guide.md`.

## Releasing

The version appears in **five** files and they must move together:
`package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`,
`python/pyproject.toml`, `python/gtl_contract/__init__.py` — plus a `CHANGELOG.md` entry.
Commits follow Conventional Commits with a descriptive body explaining *why*.
