# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.9.0] - 2026-09-01

### Fixed

- **`contract/column-not-writable` pointed at the dangerous fix on a tenancy column.** (#16)

  A reporter's `org_id` — their tenant-isolation boundary, correctly absent from every
  write schema — was flagged `column-not-writable`. The message read *"Add it to the write
  schema, or declare it in serverManaged / intentionallyAbsent."* The obvious reading is
  the first clause, and following it produces a write schema in which **a client sets its
  own tenant**: cross-tenant write access, arrived at by doing what the tool said. An agent
  following the LLM footer would open the hole or bury the finding, and report success
  either way.

  The rule is *right* that the column is not client-writable. It simply cannot tell
  "correctly locked down" from "accidentally omitted", and it led with the dangerous half.

  When the column name looks like a tenancy or ownership boundary (`org_id`,
  `organization_id`, `tenant_id`, `account_id`, `workspace_id`, `company_id`, `user_id`,
  `owner_id`, `author_id`, `customer_id`, `created_by`, `updated_by`) the message now
  leads with the safe reading — *"THIS FINDING IS CORRECT — declare it `serverManaged`"* —
  and names the consequence of the other one. **The finding still fires**, and the
  fingerprint is unchanged, so no baseline anywhere is invalidated.

  **The reporter also asked for those names in core's `DEFAULT_SERVER_MANAGED`, and that
  half is declined.** That list *suppresses* findings: shipping `user_id` in it would
  silently server-manage `user_id` on every table in every repo, hiding exactly the
  genuinely-forgotten `user_id` this rule exists to catch. It also sits in core
  `config.py`, which is the precise thing principle 3 names — *"when engine code starts
  knowing what `org_id` means, the firewall has been breached; the fix belongs in a
  provider, every time."* The heuristic is therefore in the provider, where that sentence
  sends it, and it only ever changes wording — never what fires. A pinning test keeps the
  core defaults at three timestamps.

### Changed

- **Docs: "zero defects" no longer implies a quiet first run.** (#16)
  `decision-vs-debt-guide.md` promised that a codebase with no defects meets no adoption
  cliff. True as far as it went — nothing blocks — but the same codebase opened with
  **429 findings** (137 contract, 292 openapi), essentially none of them bugs. The
  natural response to a wall of findings is `baseline`, which grandfathers the handful of
  real ones along with the noise. The guide now gives two numbers instead of one and says
  where the adoption cost actually lives: reading the debt, not fixing the defects.

### Fixed

- **`openapi/unstable-operation-id` recommended a fix that produced an INVALID document,
  and did not fix the problem it described.** (#14)

  The rule told people to write
  `FastAPI(generate_unique_id_function=lambda route: route.name)`. Nobody had ever run
  that line. It was wrong twice over.

  **It does not decouple anything.** `route.name` *is* the function name —
  `starlette.routing.get_name(endpoint)` returns `endpoint.__name__`. So the one-liner
  made the id stop *looking* auto-derived, silencing the rule, while leaving intact the
  function-name coupling the rule exists to complain about. You could satisfy this rule
  without fixing the problem.

  **And it collides.** Router factories are a normal FastAPI pattern, and every router
  built from one shares its handler names. Measured on the reporting codebase: **15
  routes onto 5 operationIds**. Reproduced here against FastAPI 0.139 — six operations
  from one factory collapse to two ids. Duplicates make the document invalid, so a code
  generator collides or silently drops methods: a client that compiles fine against an
  endpoint it can no longer call. **The rule's own recommended fix caused the exact class
  of harm the rule exists to prevent.**

  The rule now recommends
  `lambda r: f"{sorted(r.methods)[0].lower()}_{r.path}"` — unique by construction, since
  method plus path is what makes an operation unique in the document to begin with, and
  the only form genuinely decoupled from Python identifiers. The message also names the
  tag-qualified alternative honestly: readable, but unique only if your tags distinguish
  your routers, and still function-name derived.

  Corrected in all three places it was printed: the rule message, the contract-rules
  guide, and the codegen guide — plus the knowledge-base fact, whose `verify_command`
  now proves both halves of its claim rather than one.

### Added

- **`gtl-contract --exit-code`** — a status you can gate on when wiring the Python
  checker into CI directly. (#17)

  `gtl-contract check` exits 0 with 137 violations, so a job wired straight to it can
  never fail: a gate that looks like a gate and is not one. Direct invocation is a real
  need, because the check imports your application and the only runner with the app's
  Python dependencies is often not the one with Node on it.

  **The fix as filed is not the fix that shipped, and the difference matters.** The issue
  suggested exiting non-zero when `violations` is non-empty. Exit 1 already means *we
  could not check*, and `lib/adapters/contract.js` reads it that way, mapping it onto the
  idempotent-skip contract — warn loudly, never block. Overloading exit 1 would mean a run
  that found 137 real violations reaches the engine as a **skip**: warned about, never
  blocked on. The suggested fix turns a working gate into a silent one.

  So "checked and found violations" gets its own code, **3**, and the flag is opt-in —
  turning it on by default would break every existing caller's CI on a minor upgrade. The
  full protocol is now documented in `--help`, the README, and the contract guide:
  `0` checked · `1` could not check · `2` used wrong · `3` checked and found violations.
  **`1` always wins**: a run that could not look reports 1 even with `--exit-code` set.
  The flag also works on `gtl-contract openapi`. The engine never passes it — it reads
  `checked` and `violations` off the JSON, which carries more than a status byte can.

- **`openapi/duplicate-operation-id`** — two or more operations claiming the same
  `operationId`. Until now this was unchecked; the reporter had to write their own test
  to discover it. One finding per duplicated id (you fix a collision once, at the
  generator), keyed on the id so the finding survives a route joining or leaving the
  collision. The message names every colliding route.

  **It is debt, not a defect**, for an unusually direct reason: FastAPI's default
  generator includes the path and never collides, so a duplicate is almost always the
  fingerprint of a custom generator — most often the one we recommended. Blocking a patch
  upgrade for people who collided by following our own documented advice would be
  indefensible (principle 2).

- **`python/tests/test_operation_id_advice_runs.py`** — the test that would have prevented
  this. It extracts the generator the rule recommends and *runs* it against a real FastAPI
  app built the reporter's way, asserting the ids come out unique; it also pins that the
  old advice really did collide, so the regression stays evidence rather than folklore.
  Principle 4 says never emit advice the code cannot honor — a message asserting what a
  line of somebody else's framework does is a claim, and claims get tested.

  It caught one immediately: the first replacement recommendation was
  `f"{route.tags[0]}_{route.name}"`, which raises `IndexError` on any untagged route. That
  would have shipped the same class of bug in the release that fixed it.

- **Knowledge-base fact:** `route-name-generator-collides-on-router-factories`, with a
  `verify_command` CI executes — it builds the factory app, asserts the old form collides,
  and asserts the replacement does not.

## [2.8.2] - 2026-08-31

### Fixed

- **The hook installer ignored `core.hooksPath` — it wrote hooks git never executes, then
  reported them installed.** (#13)

  `getHooksDir()` hardcoded `<root>/.git/hooks`. On a repo that sets
  `core.hooksPath` — a common convention, because it lets hooks be version-controlled and
  shared across a team — git reads that directory and **never opens `.git/hooks`**. So
  `gimme-the-lint hooks` wrote two files git would never run, and `status` then read back
  the same wrong directory, found its own hook, and printed **installed**.

  Green tick, zero guard. That is the precise failure this engine exists to eliminate
  (principle 1), so it must not be how the engine ships.

  The directory is now **resolved, never assumed**: `git rev-parse --git-path hooks`,
  which honors `core.hooksPath` and linked worktrees both. If that fails (not a repo, or
  git older than 2.5) it degrades to the previous behavior rather than losing hook support.

- **`status` now names the hooks directory, and calls out hooks git will never run.**
  It prints the resolved `Hooks dir:`, and any `gimme-the-lint` hook still sitting in
  `.git/hooks` while `core.hooksPath` points elsewhere is reported as **NEVER RUN** rather
  than left to look like an install. Every release through 2.8.1 left exactly those files
  behind on a `core.hooksPath` repo. The dashboard reports the same.

### Added

- **`gimme-the-lint hooks --print <pre-commit|pre-push>`** — a snippet to embed in a hook
  you already own, for repos whose `pre-push` also regenerates a project map and scans for
  secrets. Composition, not ownership. The snippet carries the same `gtl-hook-contract`
  marker the installed hooks carry, so `status` ages an embedded block on the same terms.

### Changed

- **`hooks` refuses to overwrite a hook this tool did not write**, instead of backing it up
  and taking the file. Now that the hooks directory is resolved properly it is frequently
  *inside the working tree and version-controlled*, so "back up and overwrite" meant
  rewriting a file the whole team shares. The refusal names the conflicts and points at
  `--print`; `--force` still overwrites, keeping a `.backup`. Nothing is written when the
  check fails — a partial install half-owns the repo.

## [2.8.1] - 2026-07-17

### Fixed

- **`staleEntries` was inflated on every scoped run, and `--no-stale-baseline` failed any
  commit that did not stage the whole repo.** (#26)

  `diff()` reports every baselined fingerprint missing from the current results as
  `fixed`. That is right for a run that looked at everything and nonsense for one that did
  not: on a staged commit a per-file linter is handed two files, so the rest of the
  baseline is "missing" only because nobody opened it. Measured: 100 baselined violations,
  one file staged, nothing actually fixed — **99 reported as stale**.

  So every commit printed a warning that was false (and a warning that is always wrong is
  one people learn to skip past), and `--no-stale-baseline` — the opt-in ratchet — blocked
  any commit that did not stage the entire repository, which made it unusable on the hook
  it exists for. Worse, the code comment proposed making it the default in a future major.

  Stale entries are now counted only from runs that saw everything. The baseline stores
  `{fingerprint: count}` with no filename, so a scoped run cannot even narrow `fixed` down
  to the files it did read — the hashes are opaque — and a partial run is therefore
  excluded whole.

  Asking to fail on staleness in a run that cannot detect it is now **loud** rather than a
  quiet pass: a ratchet that silently does nothing is worse than no ratchet, because
  somebody is relying on it.

  Adapters now declare `wholeProgram`. `tsc` and `mypy` set it, so they are trusted even
  on a scoped run — they ignore targets and check everything regardless, which makes them
  the only adapters whose stale detection works on a pre-commit hook.

## [2.8.0] - 2026-07-17

### Added

- **`tsc` and `mypy` adapters — progressive type checking.** (#24) The two biggest static
  analysis surfaces most repos have, and the classic "we cannot turn it on, there are 800
  existing errors" problem, which is what a baseline is for.

  They are the first adapters that **ignore the staged-file list and always check the whole
  program**, because they have to: the type of an expression in one file depends on
  declarations in another, so a change in `a.ts` surfaces errors in `b.ts` — a file the
  commit never touched. Handed only the staged files, that breakage reports clean and
  reaches the base branch with a green tick on it. No engine change was needed for this;
  the diff already compares the full result set against the full baseline.

  Both run at **push**, not commit — whole-program checking is seconds, and a slow
  pre-commit hook is a hook people uninstall.

  Their violations are identified by the *shape* of the error rather than its text. A type
  checker names the types in its message, so renaming one type rewrites hundreds of
  messages at once; keyed on the message, a pure rename would retire every baselined
  fingerprint and introduce an equal number of new ones — blocking a refactor that changed
  no behavior, with re-baselining everything as the only practical way out. Verified
  against real `tsc` output: the message changes, the fingerprint does not.

  `tsc` binds on a `tsconfig.json`; `mypy` binds on a mypy config (`mypy.ini`,
  `[tool.mypy]`, `[mypy]`). Both are explicit adoption signals — nobody has one by
  accident. **mypy is deliberately not bound to every Python app** the way `contract` is:
  the contract check self-limits (no models, one skip line), but mypy pointed at untyped
  code reports thousands of true and unasked-for findings, which is the adoption cliff that
  teaches people to stop reading the output.

### Fixed

- **The LLM footer could tell an agent to auto-fix findings that have no autofix.** (#15)
  Guidance was computed once per run — `failed.some(u => u.supportsFix)` — so a single
  failing ESLint app flipped the entire report to "AUTOMATICALLY run `--fix`", including
  over `contract/*` and `openapi/*` findings. That is not an edge case: `--stage=push` also
  runs every commit-stage adapter, so mixed runs are the norm.

  `--fix` does nothing for a correctness finding, so an agent told to resolve the failure
  without asking reaches for the next lever that works — `baseline` — which grandfathers a
  real bug and exits 0. Reported from an adoption run where the finding in question was on
  a tenant-isolation column.

  Guidance is now derived **per class**: autofixable adapters get the `--fix` instruction
  scoped to them by name, and it is never emitted unqualified while a non-fixable adapter
  is also failing. Adapters whose findings have a *mechanical* remedy that is not `--fix`
  now declare it (`LinterAdapter#remediation`; `codegen-drift` → `gimme-the-lint
  materialize`), so those are no longer told to "fix it by hand" — which would have meant
  hand-editing a generated file that the next `materialize` overwrites.

## [2.7.1] - 2026-07-13

### Fixed

- **The rule catalogue was incomplete.** `contract/codegen-stale` and
  `contract/codegen-missing` are emitted by the Node adapter, so they were never
  registered in `gtl-contract rules` — the command the docs point at, and the thing a
  person reads before disabling a rule that just blocked their push. A catalogue that omits
  a rule sends that person away empty-handed, and they disable it on a guess. Found by
  installing the published 2.7.0 tarball and asking it to list its own rules.

  Both are catalogued now, with the incident each stands on. And because a catalogue in
  Python over an emitter in JS is two sources of truth, `tests/codegen-drift.test.js` runs
  the adapter for real and asserts every flag it emits matches the catalogue — so they
  cannot drift apart. (They already did once, in the other direction: `openapi.js` inferred
  `neverBaseline` by rule-id exclusion and silently promoted two debt rules to defects.)

## [2.7.0] - 2026-07-13

**Drift lives wherever two artifacts must _agree_. It cannot exist where one is
_derived_.** v2.6.0 guarded every rung of the chain where two things must agree, and none
of the rungs where one is derived — so the truth reached the edge of Python and was then
handed to a human to retype into TypeScript.

```
   Postgres columns
        ⇕   alembic-check                       v2.6.0
   SQLAlchemy models
        ⇕   17 contract rules                   v2.6.0
   Pydantic schemas
        ↓   materialize → openapi.json          v2.6.0
   openapi.json
        ↓   openapi-typescript → api-types.ts   v2.7.0  ← this
   frontend types
```

Closes #11.

### Added — `codegen-drift`

Your frontend's types, generated from the API they are typed against — and checked.

**The bug it exists for:** a component read `prospect.zip`. The API returns `zip_code`.
The backend was correct, the contract check was green, the lockfile was fresh, the
database row was right — and **the user saw a blank ZIP field for a full release cycle**,
because `undefined` renders as nothing, and nothing looks exactly like *"the data was
never saved."*

**And a worse one:** a hand-written `TaskFormData` declared `estimated_hours` — no such
column; the real one is `estimated_cost`, **one word away** — and `dependencies`, which
does not exist either, while omitting `notes`, `deal_id`, `estimated_cost` and
`is_recurring`, which all do. Wrong in both directions at once.

The v2.6.0 contract check reports **zero violations** on that model. The backend is
correct and always was. **The lie was entirely in the hand-written mirror**, and every
guard we shipped passed it, because the lie was not in Python. Both bugs were found by a
human clicking around in a browser.

With generated types, the first is a compile error and the second is a sentence the
compiler will not let you write.

- **`contract/codegen-stale`** — a **defect**, never baselineable. A stale generated type
  is not a *gap*; it is **a lie the compiler is currently believing**.
- **`contract/codegen-missing`** — debt. Every repo starts without generated types, and a
  check you must repair your repo to install is a check nobody installs.

Opt-in twice over (a generator **and** an output path). A hand-written types file is
**never overwritten** — the generator signs its own output, and a file without that
signature is yours. `check` still reports where it disagrees with your API; it just will
not touch it.

### Added — spec quality, because otherwise the guard is green over nothing

A lockfile can be perfectly fresh and completely worthless.

- **`openapi/route-without-response-model`** (debt) — FastAPI cannot infer a response
  schema from a function that does not declare one, so it emits an **empty** one. A
  generator then types the whole endpoint `any`, and your client compiles against a shape
  **nobody has ever checked**. **48 of 243 routes** on the first real codebase.
- **`openapi/unstable-operation-id`** (debt) — generators turn `operationId` into the
  client *method name*, and FastAPI derives `operationId` from the **function name**. So
  renaming a handler — a pure refactor, touching no API — silently renames every generated
  client method, and ships as a breaking change to every consumer. **243 of 243 routes.**
  One line at app construction fixes it repo-wide.

**A perfect lockfile over an incomplete spec is a perfect record of a lie.**

### Fixed

- **`neverBaseline` was inferred by exclusion**, and it was a time bomb. `openapi.js`
  guessed from the rule id — *"everything except `lockfile-missing` is a defect"* — which
  is correct for exactly as long as there are two rules. The moment two more arrived, both
  were silently promoted to **defects**, and `route-without-response-model` fires 48 times
  on a real codebase: adoption would have meant fixing 48 routes before your next commit,
  and nobody does that. They uninstall. The provider now **declares** it; the engine does
  not get a vote. **Rules belong to the linter that defines them.**
- **`materialize` would have generated from yesterday's lockfile.** A unit's `linters`
  array is sorted, and alphabetically `codegen-drift` sorts *before* `openapi` — so the
  client types would have been generated from the old lockfile, the lockfile then
  overwritten, and success reported. The types would have been stale the instant they were
  written, by the very command whose job is to make them fresh. `materialize` now runs in
  **registry order**, which encodes the derivation chain.

### Changed

- `schema-lockfile-guide.md` used to end with a shell command and a shrug — telling you to
  run `openapi-typescript` by hand and hoping you remembered. Nothing failed if you did
  not. **The tool owns that step now.**

## [2.6.0] - 2026-07-13

The engine has always asked *"is this code well-formed?"*. It now also asks **"does your
data model agree with the schemas that expose it?"** — on the same only-new-violations-block
terms, with one deliberate exception.

### ⚠ Upgrading: one thing you must do

**Re-run `gimme-the-lint hooks`.** Git hooks are installed *files*; `npm update` cannot
rewrite one you installed months ago, and a stale hook will silently never run the new
checks. `status` and `dashboard` now warn when your hooks predate the engine.

Everything else is additive. **Your baselines are safe** — a violation with no
`fingerprintKey` hashes exactly as it did in 2.5.2, asserted against literal digests, and
verified by baselining a project with the real 2.5.2 binary and reading it back with this
one: zero new violations, baseline file byte-identical.

The full error catalog is in
[`.documentation/upgrade-guide.md`](.documentation/upgrade-guide.md), inline rather than
by reference — when a push is blocked and the error gets pasted into a chat window, a link
is a dead end.

### Added — the entity contract

`gtl-contract`, a Python checker shipped inside the npm package (`python/`). The first
linter gimme-the-lint **authors** rather than wraps, because no third-party tool checks
whether a SQLAlchemy model agrees with the Pydantic schemas exposing it.

Seventeen rules, **each standing on a production bug it would have caught**:

- **A user filled in twelve fields on a form and four were saved.** The API returned 201.
  `PropertyCreate` declared 17 of 37 columns; `extra='ignore'` dropped the rest.
  → `contract/column-not-writable`
- **Clicking Save reset every approved budget line item to `pending` and wiped its notes.**
  The user changed nothing. An update schema carried `status = "pending"`, and an update
  schema is applied *over* a stored row — so the default overwrote what was there. **It
  returned 200.** → `contract/update-has-create-default`
- **Every conversation returned a 500 on GET and PUT, forever.** `metadata` is reserved on
  every SQLAlchemy model — `Base.metadata` *is* the MetaData registry — so a response
  field of that name read the registry instead of a column.
  → `contract/reserved-metadata-unaliased`
- **A JSON column typed `str` in the response.** Harmless until the first *correct* value
  was written, then every read 500'd and the whole page went down.
  → `contract/response-type-mismatch`
- **Four entities nobody knew were entities**, because their schemas lived in `routers/`
  rather than `schemas/` and a scan of the obvious place missed them.
  → `contract/unregistered-write-surface`

It **imports your application** rather than parsing it, because the authoritative list of
what a client can write lives in the route table, not in the filenames.
`UpdateTierRequest` writes `organizations.tier` and is called nothing of the sort — a
name-based scan reports that table as having no write surface and moves on. **A scan whose
miss is invisible to itself is worse than no scan, because it is believed.**

Runs on **push**, not commit: importing an app costs seconds, and a three-second
pre-commit hook is a hook people disable.

### Added — defects cannot be grandfathered

The one place this tool stops being progressive.

**Debt** is a gap: the app works, it has a hole in it. Grandfather it — that is what
progressive linting is *for*. **A defect is broken right now, for everyone.**
Grandfathering one means writing down *"we accept that every read of this entity returns a
500"*, and nobody would say that out loud, so the tool will not say it for them.

The predicate is **not** "returns a 500". `update-has-create-default` returns a cheerful
200 while destroying your data, which is worse — because a 500 is loud.

Three independent gates, because this is the rule people will most want to work around:
`baseline` will not capture it; the diff engine ignores a hand-planted hash; and
`baseline` says what it refused, with the escape hatch. That hatch is real and
deliberately expensive: except it in `.gtl/config.js`, **with a reason**.

### Added — the API contract lockfile

FastAPI computes an OpenAPI document from your schemas and serves it at `/openapi.json`.
It is complete, correct, and **invisible to every tool that reads files** — so nothing
stops a field rename from silently breaking every client.

`gimme-the-lint materialize` writes it down. `check` then reports when the code and the
lockfile part company (`contract/lockfile-stale`), which is what makes the whole thing
trustworthy: without it, a stale lockfile asserts an API you no longer serve and the
breaking-change check compares two identical stale files and finds nothing. **The guard
goes inert and still shows green.**

A **hand-authored** spec is never overwritten. The emitted document carries
`x-generated-by`; a file without that marker is yours, and `materialize` refuses it byte
for byte. When an authored spec and the code disagree, that disagreement is itself the
finding (`contract/spec-implementation-mismatch`) — and neither file is touched.

### Added — `verify`, and the external tier

`alembic check` catches the migration you forgot to generate. Your tests pass because the
test database is built from the **models**; production is built from the **migrations**.

It needs a live database, so it is `external` tier — **structurally** unreachable from
`check`, which is a git hook and must stay hermetic. It runs only from
`gimme-the-lint verify`, in CI. No combination of flags can talk `check` into running one,
and under `--offline`, `verify` **fails** rather than skipping: a silent skip would let a
CI job go green having verified nothing.

### Added — more linters

- **`squawk`** — migration *safety*. `ALTER TABLE … ADD COLUMN … NOT NULL DEFAULT ''` is
  fine on your laptop and takes an ACCESS EXCLUSIVE lock on forty million rows in
  production. Nothing about the SQL is malformed, so a syntax linter has nothing to say.
- **`buf`** + **`buf-breaking`** — protobuf lint and breaking-change detection. Two
  registry entries over one binary, so lint debt and breakage baseline *independently*.
- **`spectral`** — OpenAPI/AsyncAPI lint, for hand-authored specs.

### Added — engine

- **`fingerprintKey`** — optional, file-independent violation identity. A schema that
  moves to another file keeps its baseline; a message that enumerates a changing set
  ("no write schema accepts [a, b]" → "[a, b, c]") stops re-reporting known problems as new.
- **`tier`** (`local`/`reference`/`external`) and **`stage`** (`commit`/`push`/`ci`) on the
  adapter contract. Orthogonal: a `local` adapter can still be too slow for a commit hook.
- **`--stage`**, defaulting to `commit` — a safety property, not a preference. A stale hook
  degrades to *"the new check doesn't fire yet"* (loud, one command to fix), never to
  *"your commits got slow"* (silent, and fixed by uninstalling).
- **Stale baseline entries are reported.** The engine has always computed which baselined
  violations no longer occur and always thrown them away; surfacing them is what makes a
  baseline a ratchet that only shrinks. Informational — failing is opt-in via
  `--no-stale-baseline`.

### Changed

- **Remediation guidance now derives from the adapters that actually failed.** The hooks
  used to print *"For LLMs: AUTOMATICALLY run `--fix`"* unconditionally. For a rule with no
  autofix that is a dead end — and the next lever an agent reaches for is `baseline`, which
  does not fix the defect, it **grandfathers** it, and then reports success. Non-fixable
  failures now say so, and explicitly forbid both `--fix` and `baseline`.
- A baseline section's `total` counts violations **grandfathered**, not violations *found*.
  With a refused defect in play those differ, and the baseline was reporting "15 baselined"
  next to a file holding 10.
- `verify` no longer tells users with no external checks to "run baseline", and the report
  says what actually happens next ("Verified." rather than "Safe to commit." when you are
  three hours past the commit).

### Fixed

- **The GitHub Action's documented usage never worked.** The README and the shipped
  template both said `uses: TheGlitchKing/gimme-the-lint@v2` — and **that tag has never
  existed.** Every user who followed the docs got `unable to find version v2`. The
  floating `v2` tag now exists and moves with each 2.x release; the README and template
  pin `@v2.6.0` explicitly.
- **The workflow *template* was being executed as a live workflow.** It sat in
  `.github/workflows/lint.template.yml`, and GitHub Actions runs every `.yml` in that
  directory regardless of what it is called. So it ran on every PR to this repo, for the
  whole v2 line, and failed every time — against the `@v2` tag above. Moved to
  `templates/`, where the other templates live and where GitHub will not execute it.
- **This repo had no CI.** The only thing in `.github/workflows/` was that broken
  template, so `npm test` had never run on a pull request. A project whose entire purpose
  is to stop guards from silently not guarding shipped for a year with a check that was
  always red and therefore never read. There is now a real CI: the Node suite on 20/22/24,
  the Python suite on 3.11/3.12/3.13, and a job that packs the tarball, extracts it,
  pip-installs it and runs the shipped checker — because "it works in the repo" proves
  nothing about what users actually get.
- **The npm tarball shipped the Python test suite** — including deliberately-broken
  SQLAlchemy fixtures — into every consumer's `node_modules`. `.npmignore` does not help:
  `files` is an allowlist and overrides it. CI now fails if they reappear.

## [2.5.2] - 2026-05-21

### Changed
- **Package description names every supported linter.** The npm/`--help`
  description previously listed languages only (`JavaScript/TypeScript, Python,
  Go, Rust, Terraform, and Ansible`), so someone searching for "does this
  support tflint?" couldn't tell from `--help` or the npmjs.com page. The
  description now spells out language → linter pairs: JavaScript/TypeScript
  (ESLint, Biome), Python (Ruff), Go (golangci-lint), Rust (Clippy),
  Terraform/OpenTofu (tflint), Ansible (ansible-lint). Metadata-only change
  across `package.json`, `.claude-plugin/plugin.json`, and
  `.claude-plugin/marketplace.json`. No code changes.

## [2.5.1] - 2026-05-17

### Fixed
- **tflint config resolution is now root-aware.** In the standard Terraform
  monorepo — one repo-root `.tflint.hcl`, many nested `modules/*` / `envs/*`
  units — the adapter resolved config only in the unit directory, so every
  unit was linted with tflint defaults: the repo's preset, plugin declarations
  and `rule { enabled = false }` overrides were silently ignored and
  `tflint --init` never ran. Meanwhile `configHashFor()` *did* find the
  repo-root config, so the baseline's `config_hash` reflected a config the
  linter never actually used — a silent correctness bug. A new shared resolver,
  `LinterAdapter.resolveConfigPath()`, walks up from the unit directory to the
  project root; `buildCommand()` and `initCommand()` now pass the resolved
  file as an absolute `--config`, and `configHashFor()` hashes that same file —
  the hashed config and the linted config can no longer disagree. A unit with
  its own `.tflint.hcl` still wins (nearest-first); a repo with no config
  anywhere still runs the zero-config core ruleset. The resolver is generic
  (no provider name in code) and root-aware config-hashing now benefits every
  adapter.

## [2.5.0] - 2026-05-17

### Added
- **`.gtl/config.js` — consolidated config location.** gimme-the-lint's own
  config file now lives canonically at `.gtl/config.js` (`.gtl/config.cjs` for
  ESM projects), so it travels with the committed `.gtl/` baselines rather than
  sitting loose at the repo root. `install` and `migrate` write new configs
  there; `config-manager.findConfig()` resolves the location. A repo-root
  `gimme-the-lint.config.js` is still read as a fallback — existing projects
  need no change — and `.gtl/` wins when both exist. `uninstall` removes a
  repo-root config but leaves a `.gtl/` one in place (it is part of the
  preserved `.gtl/` directory). Linter configs (`eslint.config.js`,
  `.tflint.hcl`, …) are unaffected: each linter resolves its own config from a
  fixed location gimme-the-lint does not own.

## [2.4.0] - 2026-05-17

### Fixed
- **tflint silent-failure on uninitialized ruleset plugins.** When a unit
  carries a `.tflint.hcl`, tflint requires `tflint --init` before linting; the
  adapter never ran it, so a failed run was recorded as a clean zero-violation
  baseline that mis-gated every later commit. Adapters gain an `initCommand()`
  hook (run once per directory); the tflint adapter runs `tflint --init` when a
  `.tflint.hcl` is present. `parse()` now takes `(stdout, stderr, code)` — a
  non-zero exit with no parseable JSON emits a high-severity `tflint-error`
  violation, never a silent clean pass.
- **eslint false-positive on a tooling-only `package.json`.** Discovery bound
  eslint on the filename alone, so a devDependencies-only, source-free
  `package.json` (one that merely pins a tooling dependency) became an eslint
  app. `package.json` is now a conditional marker — eslint is bound only when
  the directory looks like a real JS app (runtime deps / entry-point fields /
  JS-TS source / an eslint or biome config). `EslintAdapter.detect()` is
  likewise tightened so a bare `package.json` is insufficient.
- **tflint `available()` over-reporting.** It returned true even when ruleset
  plugins a `.tflint.hcl` declared were not installed, disagreeing with
  `lint()`. It now verifies every declared plugin resolves.
- **`.terraform.lock.hcl` removed from the tflint manifest files** — it is a
  provider-lock file written by `terraform init`, not a tflint signal.

### Added
- **Generic ruleset-plugin version tracking.** `TflintAdapter.rulesetVersions()`
  parses `tflint --version` into a `{ ruleset: version }` map — no ruleset name
  is special-cased. A new `ruleset_versions` field is threaded through
  baselines and the global manifest; drift detection emits a `ruleset` drift
  entry when a plugin version changes, catching a plugin update under a loose
  `.tflint.hcl` version constraint that left `config_hash` and `tool_version`
  untouched.
- **Rule rename/removal migration.** Per-linter rule-alias maps
  (`lib/rule-aliases.js`) plus `gimme-the-lint migrate --rules`: re-lints each
  unit and rewrites a renamed rule's baseline fingerprint old→new (preserving
  the grandfather count), drops entries for rules that no longer occur, and
  corrects `total`. A genuinely new violation is never grandfathered.

### Changed
- **`tflint.parse()` signature** is now `(stdout, stderr, code)`, matching the
  base adapter contract.
- **Removed the dead v1 drift path.** `lib/drift-detector.js` (superseded by
  `lib/drift.js`) is deleted; `lib/manifest-manager.js` is slimmed to its one
  live function, `hashFile()` — the v2 global manifest is owned by
  `lib/gtl-manifest.js`.

### Design
- The tflint adapter never names a cloud provider. The bundled `terraform`
  ruleset lints any Terraform repo with zero config; provider-specific rulesets
  are opt-in and owned entirely by the target repo's own `.tflint.hcl`, which
  the adapter parses generically for whatever `plugin` blocks it declares.

## [2.3.0] - 2026-05-17

### Fixed
- **Bug A — monorepo linter binary resolution.** The ESLint and Biome adapters
  resolved `node_modules/.bin/<linter>` only at the repo root, so in a monorepo
  (where each JS app carries its own `node_modules`) `available()` returned
  false and the linter was silently skipped — capturing an empty baseline.
  Adapters now resolve the binary app-dir-first (app → repo root → PATH) and
  run inside the app directory so the app's own flat config is discovered. The
  Ruff adapter resolves its `.venv` the same way.
- **Bug B — discovery bound the wrong directories.** Manifest discovery treated
  a bare `requirements.txt` as a ruff app marker (binding nested load-test and
  utility dirs) and discarded a repo-root config whenever any nested manifest
  existed (leaving the real app unbound). `requirements.txt` is no longer a
  discovery marker — `pyproject.toml`, `ruff.toml`, `.ruff.toml` and `setup.py`
  are — and workspace-root detection is now **per linter**, so a repo-root
  `[tool.ruff]` config binds the root even when nested `package.json` apps sit
  below it.
- **Bug C — "couldn't run" collapsed into "skipped".** An unavailable or
  errored linter was recorded with the status used for "no code here", making
  an incomplete baseline indistinguishable from a clean one — every
  pre-existing violation later counted as new and blocked the commit. New
  baseline statuses `unavailable` and `error` keep incomplete baselines
  distinct; `migrate` and `baseline` print a prominent summary and exit
  non-zero (override with `--allow-incomplete`); `hooks` refuses to install
  against an incomplete baseline (override with `--force`); `check` reports
  `needs-baseline` instead of flooding new violations.

### Added
- `migrate` now writes the discovered app/linter layout into
  `gimme-the-lint.config.js` as an explicit `apps` map, so the guess is visible
  and editable instead of silently re-derived on every run. It also emits a
  warning when the layout is ambiguous (a repo-root config plus nested apps).

## [2.2.0] - 2026-05-17

### Added
- **Ansible support** via a new `ansible-lint` adapter. ansible-lint plugs into
  the progressive-lint engine like every other linter: it runs
  `ansible-lint -f codeclimate`, parses the CodeClimate JSON report, and only
  new violations block. Supports `--fix`.
- **Manifest-based discovery** for Ansible: a directory containing `ansible.cfg`
  or `galaxy.yml` is auto-discovered and bound to `ansible-lint`. Ansible
  playbooks are plain YAML with no manifest, so detection keys off those
  unambiguous markers rather than a file extension (a YAML scan would match
  nearly every repo). An Ansible repo with neither marker needs an explicit
  `apps` entry in `gimme-the-lint.config.js`.
- **Ansible best-practice config** — `install` seeds `.ansible-lint` with the
  `moderate` profile (the strictness lever; raise to `safety` / `production`).
- README now documents every supported codebase with a default-rules summary
  and the strictness lever for each; `.documentation/lint-rules-guide.md` adds
  a full Ansible section.

## [2.1.0] - 2026-05-17

### Added
- **Terraform / OpenTofu support** via a new `tflint` linter adapter. tflint
  plugs into the same progressive-lint engine as every other linter: baselines
  are captured into `.gtl/apps/<app>/baseline.json` under a `tflint` section,
  fingerprinted by `file + rule + message`, and only new violations block.
  - Runs `tflint --format=json`, module-scoped (executes inside the module
    directory for compatibility with tflint versions predating `--chdir`).
  - Parses both `issues` and `errors` — broken HCL surfaces as a blocking
    error rather than slipping through as zero issues.
  - Supports `--fix`; tracks config drift on `.tflint.hcl`.
- **Extension-based app discovery** for Terraform: a directory containing
  `*.tf` / `*.tofu` source is auto-discovered and bound to `tflint`. Terraform
  has no manifest file, so it is discovered by extension rather than by a
  manifest like `package.json` or `go.mod`. In the root-module layout (`.tf`
  at the repo root *and* in `modules/*/`), the root is treated as a workspace
  root — bind `.` explicitly in `gimme-the-lint.config.js` to lint it. See the
  installation guide.
- **Best-practice config templates** for every supported codebase. `install`
  now seeds each discovered app with a curated, "recommended tier" config for
  its linter — `eslint.config.js` + `.prettierrc.json`, `biome.json`,
  `pyproject.toml` `[tool.ruff]`, `.golangci.yml` (golangci-lint v2 format),
  `clippy.toml` + `Cargo.toml` `[lints.clippy]`, `.tflint.hcl`. Every write is
  create-if-absent — an existing config is never overwritten (`--force`
  replaces). New module `lib/linter-configs.js`.
- **Security lint rules** across every codebase. gitleaks remains the universal
  secret scanner (passwords, SSL/private keys, tokens — always blocks, never
  baselined) and its template now also flags PEM private keys and hardcoded
  password assignments. Per-linter security layers are enabled in the shipped
  configs: `gosec` (Go), Ruff `S` / flake8-bandit (Python),
  `eslint-plugin-security` + `eslint-plugin-no-secrets` (JS/TS), and Biome's
  `security` rule group.
- **Prettier support** — a `.prettierrc.json` template is seeded for ESLint
  apps, and the ESLint config now applies `eslint-config-prettier` so the two
  do not fight over formatting. The ESLint template refresh is additive: every
  pre-existing rule (architecture import guards, `no-cycle`, unused-vars) is
  retained.
- **New documentation** — `.documentation/lint-rules-guide.md` documents every
  supported codebase, its baseline rules, the security layers, and how/where to
  adjust them.

## [2.0.0] - 2026-05-17

A ground-up rearchitecture: gimme-the-lint is now a language-agnostic
progressive-lint engine that owns its own baseline diffing, driven by
per-directory linter adapters.

### Breaking Changes
- **Baseline layout moved** from `frontend/.lttf/` + `backend/.lttf-ruff/` to a
  single per-app tree, `.gtl/apps/<app>/baseline.json`, plus a global
  `.gtl/manifest.json`. Run `gimme-the-lint migrate` to convert (it backs up
  the legacy directories and re-baselines).
- **Baseline file format changed** to a linter-agnostic fingerprint map.
- **Config schema changed**: the `frontend`/`backend` model is replaced by an
  optional `apps` map binding directories to linters; `skipPatterns` added.
  `lttfDir`/`ruffBaselineDir` keys removed.
- **`check` flags removed**: `--frontend-only`, `--backend-only`, `--verbose`.
- **GitHub Action inputs changed**: `frontend`/`backend` removed (linting is
  now polyglot auto-detect); `strict` added. Pin `@v2`.
- The `lint-to-the-future` dependency is gone — gimme-the-lint no longer shells
  out to it; ESLint progressivity is handled by the in-house engine.

### Added
- In-house progressive-diff engine: line/column-independent violation
  fingerprints, so baselined violations survive code shifting in a file.
- Linter adapter interface — each linter is a self-contained adapter.
- **Go** support via `golangci-lint` and **Rust** support via `cargo clippy`,
  alongside ESLint and **Biome** (JS/TS) and Ruff (Python).
- **Biome** adapter: a `biome.json` binds an app to Biome and supersedes the
  default ESLint binding for that app.
- Polyglot project model: apps auto-discovered by walking for package
  manifests; monorepo workspaces handled; `_template-*` dirs skipped.
- Per-app drift detection (app add/remove, config, linter version, age) —
  a change in one app never churns unrelated baselines.
- Idempotent skips: an app with code but no installed linter is warn-skipped
  (never blocks), or fails loudly under `--strict`.
- `--offline` install for air-gapped environments (no npm/pip fetches; fails
  loudly on a missing toolchain).
- `--no-baseline` greenfield install / `baseline --empty` — "strict from day
  one" with nothing grandfathered.
- `gimme-the-lint migrate` — one-shot v1 → v2 migration.

### Changed
- `run-checks.sh`, `eslint-baseline.sh`, `ruff-baseline.sh`, `dashboard.sh` are
  now thin shims over the Node engine.
- The dashboard renders from `.gtl/manifest.json` with per-app drift.

## [1.1.2] - 2026-04-11

### Fixed
- Plugin manifest now passes `claude plugin validate`. Rewrote `.claude-plugin/plugin.json` to the minimal schema Claude Code actually accepts (dropped `displayName`, `claudeCodeVersion`, `type`, `commands`, `agents`, `hooks` — all of those were either unsupported keys or wrongly-shaped arrays that the validator rejected).
- Moved command definitions from `.claude-plugin/commands/*.md` → `commands/*.md` at the repo root (Claude Code's auto-discovery convention).
- Added YAML frontmatter (`description` field) to all three command files and to `agents/linting-agent.md`.

### Added
- `.claude-plugin/marketplace.json` — registers gimme-the-lint as a standalone Claude Code marketplace, so users can install with `claude plugin install gimme-the-lint@gimme-the-lint-marketplace`.
- `commands/` added to npm `files` array so the plugin's slash commands actually ship in the tarball.

## [1.1.1] - 2026-03-19

### Fixed
- ESM project support: `initConfig()` now writes `gimme-the-lint.config.cjs` when the target project has `"type": "module"` in package.json
- `getConfig()` checks for `.cjs` first, then falls back to `.js`
- All shell scripts and `action.yml` use two-step config lookup (`.cjs` then `.js`)

## [1.1.0] - 2026-03-19

### Added
- Shell scripts now read `gimme-the-lint.config.js` for directory paths (`frontendDir`, `backendDir`, `srcDir`, `appDir`)
- Config-driven directory detection in `run-checks.sh`, `eslint-baseline.sh`, `ruff-baseline.sh`, `dashboard.sh`, and `action.yml` inline fallback
- Backward-compatible: if no config file exists, auto-detection falls through to existing logic

## [1.0.1] - 2026-02-03

### Changed
- Updated Python minimum version from 3.8 to 3.11
- Updated GitHub Action defaults: Node.js 20 → 22, Python 3.11 → 3.13
- Updated Python dependency floors: ruff >=0.9.0, mypy >=1.15.0, pytest >=9.0.0, pytest-asyncio >=1.0.0, pytest-cov >=7.0.0

### Added
- Documentation guides in `.documentation/`: installation, when-to-use, how-to-use, troubleshooting

## [1.0.0] - 2026-02-03

### Added
- Progressive linting system for monorepo projects (Python + JS/TS)
- Directory-chunked auto-discovery of production directories
- Per-directory baselines (ESLint for frontend, Ruff for backend)
- Manifest-based drift detection (directory, config, time, violation drift)
- Auto-healing: manifests update automatically on re-baseline
- Python .venv auto-creation with ruff, mypy installation
- Git hooks (pre-commit for changed files, pre-push for full lint)
- GitHub Action (`action.yml`) for CI/CD integration with PR comments
- Workflow template for easy adoption
- Claude Code plugin integration with /lint, /lint:status, /lint:baseline commands
- CLI tool with install, check, baseline, dashboard, hooks, venv, status commands
- Configuration templates: ESLint v9 flat config, pyproject.toml (Ruff), gitleaks, commitlint, pre-commit
- Auto-fix support via `--fix` flag
- LLM-optimized pre-commit output (instructs Claude Code to auto-fix without asking)
