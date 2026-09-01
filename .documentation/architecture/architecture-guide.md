---
title: Architecture
tier: reference
domains:
  - architecture
status: active
last_updated: 2026-07-17T00:00:00.000Z
version: 2.8.0
word_count: 866
estimated_read_time: 5 minutes
last_validated: 2026-07-17
---

# Architecture — where it lives, and why

## Two artifacts, one plugin

```
gimme-the-lint  (npm, Node)          gtl-contract  (Python, in python/)
├── the engine                       ├── the introspector
│   fingerprint / diff / baseline    │   walks the ORM registry, reads the route table
├── 17 adapters                      ├── 21 rules
│   eslint ruff clippy tflint …      │   and the incident each one stands on
│   contract  ←────── shells to ────→└── prints violations as JSON
└── CLI, hooks, GitHub Action
```

**Every other adapter wraps somebody else's linter. This one wraps ours** — because no
third-party tool checks whether a SQLAlchemy model agrees with the Pydantic schemas
exposing it. That is the only unusual thing about it. Structurally, `contract.js` is
`ruff.js`: resolve a binary out of the venv, run it, parse JSON, hand back violations.

### Why one plugin and not two

A separate `gimme-the-lint-schema` package would need `fingerprint.js`,
`diff-engine.js`, `baseline-store.js`, `units.js`, `project-model.js`, `drift.js`,
`check.js`, `report.js`, plus its own CLI, Action and githooks. **That is the entire
product.** The schema-specific part is the *rules*; everything else is the engine that
already exists.

You would end up either duplicating the engine, or depending on gimme-the-lint as a
library — at which point the split buys nothing and costs the user two baselines, two
dashboards, and two githooks.

### Why `gtl-contract` is vendored, not on PyPI

`python/` ships **inside the npm tarball** and is pip-installed from the local path:

```
pip install ./node_modules/@theglitchking/gimme-the-lint/python
```

Two problems delete themselves:

- **Air-gapped installs need no network.** `--offline` is a supported mode; a PyPI
  dependency would force every air-gapped user to provision `gtl-contract` into their
  image by hand.
- **Version skew is structurally impossible.** The adapter and the checker share a JSON
  wire format. Ship them as one artifact and there is no version to skew and no protocol
  to negotiate.

`gtl-contract` declares **no dependencies**, deliberately. It inspects *your* SQLAlchemy
and *your* Pydantic, using the versions your app already pins. Declaring `sqlalchemy>=2`
could drag a second, different SQLAlchemy into the venv and inspect a registry your
application never populated — and then report confidently on a model layer that does not
exist.

#### The cost, which is real: a Python job now depends on `npm ci`

This was raised in #20 and it is a fair complaint, not a misunderstanding. A CI job that
otherwise touches no Node has to run `npm ci` first, purely to obtain a Python package.
That is awkward, and vendoring is what makes it so.

**We are keeping it anyway**, and the trade is deliberate rather than accidental:

| | vendored (today) | on PyPI |
|---|---|---|
| air-gapped install | works, no network | needs the package provisioned by hand |
| adapter/checker version skew | structurally impossible | possible, and silent |
| Python-only CI job | needs `npm ci` | clean |

The second row is what settles it. The adapter and the checker share a JSON wire
protocol with no negotiation step, and a skewed pair does not fail loudly — it produces
a report the other half misreads. Publishing a second distribution channel creates a
version pair that can disagree, in exchange for removing a setup step. A tool whose whole
thesis is "never report green while not guarding" should not take that trade.

The awkwardness is real and the answer to it is documentation, not a second artifact:
install the checker once into the venv that runs your tests (see
[`contract-guide.md`](../api/contract-guide.md#which-venv-gets-gtl-contract)) and the
`npm ci` coupling is a one-time setup cost rather than a per-job one.

---

## Tier and stage — two orthogonal axes

Adapters declare **what they need** and **when they fire**. Both are safety gates, and
both fail in directions that are hard to notice.

### `tier` — what it needs

| tier | needs | runs in `check` (a git hook)? | under `--offline`? |
|---|---|---|---|
| `local` | files on disk (+ your venv) | ✅ | ✅ |
| `reference` | + git **history** | ✅ | ✅ (git is local) |
| `external` | + a database / registry / network | ❌ **never** | ❌ fails closed |

An `external` adapter is **structurally** unreachable from `check` — not by convention,
and no combination of flags can talk it into running. It runs only from
`gimme-the-lint verify`, in CI, where credentials legitimately live.

> A pre-commit hook that dials a database fails on an aeroplane, hangs behind a VPN, and
> is uninstalled within the week.

### `stage` — when it fires

| stage | means |
|---|---|
| `commit` | fast enough for every commit. The default; every ordinary linter. |
| `push` | too slow for every commit, fine once per push. |
| `ci` | never on a hook at all. |

These are **orthogonal**: a `local` adapter can still be too slow for a commit hook,
which is exactly the contract check's situation (it imports your whole app).

**`--stage` defaults to `commit`, and that default is a safety property.** Git hooks are
installed *files*; upgrading the package cannot rewrite one you installed months ago.
Those stale hooks call `check` with no `--stage`. Had the default been "run everything",
they would silently have begun importing your app on every commit. Defaulting to
`commit` makes a stale hook do **less**, never more.

### The current roster

| adapter | tier | stage |
|---|---|---|
| eslint, biome, ruff, golangci-lint, clippy, tflint, ansible-lint, squawk, spectral, buf, codegen-drift | `local` | `commit` |
| contract, openapi, tsc, mypy | `local` | `push` |
| buf-breaking | `reference` | `push` |
| alembic-check | `external` | `ci` |

### A third axis, and it belongs to exactly two adapters

`tsc` and `mypy` **ignore the file list they are handed and always check the whole
program.** Every other adapter lints what it is given; at commit time that is the staged
set.

A type checker cannot work that way. The type of an expression in one file depends on
declarations in another, so checking the staged files alone is not a cheaper version of
the same question — it is a weaker one. And the errors a change causes are usually *not
in the changed file*: alter a return type and the breakage lands in every caller, none of
which the commit touched. Handed only the staged files, a type checker reports those
callers clean, and the break reaches the base branch under a green tick.

This needed no engine support. `diff-engine.js` compares the full produced set against
the full baseline section — there is no scope in the diff at all — so an adapter that
returns everything gets exactly the right answer, and a caller broken in an untouched
file shows up as new.

The cost is that a full run is seconds rather than milliseconds, which is what `push`
is for. Note this is `stage`, not `tier`: they need nothing but files on disk.

They declare it with `wholeProgram = true` on the adapter, and the engine needs to know
for one further reason: **a baselined violation missing from the results has either been
fixed or was never looked at, and those are the same absence.** Only an adapter that saw
everything can tell them apart, so `check` counts stale baseline entries from complete
runs only — a scoped run reports none, and says so if you asked it to fail on them.
Whole-program adapters are exempt from that suppression, because they are complete even
when the run is scoped.

---

## The engine

```
lib/
├── violation.js       NormalizedViolation — the linter-agnostic currency
├── fingerprint.js     violation identity. Position-independent by design.
├── diff-engine.js     pure: new vs baselined vs fixed
├── baseline-store.js  one baseline.json format for every linter
├── check.js           lint → diff → report          (a git hook)
├── verify.js          the external tier             (CI only)
├── baseline.js        capture violations into .gtl/
├── git-ref.js         resolve the base ref. Git IS the snapshot.
├── project-model.js   discover apps, bind them to linters
└── adapters/          one per linter + the base contract
```

**The engine is pure and fully unit-tested. Adapters wrap real linters.** The CLI, git
hooks, GitHub Action and Claude plugin are thin front doors over it.

### Where to add things

| you want to… | do this |
|---|---|
| add a **linter** | one file in `lib/adapters/`, one line in `adapters/index.js` |
| add a **contract rule** | `python/gtl_contract/rules.py` + a check in `providers/*/checks.py` |
| add an ORM/DTO **provider** (Django+DRF, Prisma+zod) | one module in `python/gtl_contract/providers/`, one registry entry |

> *"Adding a language means adding one entry to this map — nothing else in the engine
> needs to change."* That line is in `adapters/index.js`, and it is still true.

Rules belong to the provider, exactly as ESLint's rules belong to ESLint. The engine only
ever sees violations. A few contract rules are stack-specific — the `metadata` /
`Base.metadata` collision is purely SQLAlchemy — and that is correct, not a wart.

---

## Identity: `fingerprintKey`

A violation's identity is normally `file + rule + message`, deliberately excluding line
numbers so a baselined violation survives code moving up or down a file.

Some linters can do better. When a linter can *name the thing it is complaining about* —
`Deal.operating_expenses:writable`, `acme.user.v1.User.email` — it supplies a
`fingerprintKey`, and identity becomes `key + rule`, ignoring file and message entirely.

That matters because:

- **Schemas get moved.** `app/schemas/deal.py` → `app/domain/deal/schemas.py`. A
  path-keyed baseline would evaporate on the rename and resurrect every finding it had
  grandfathered.
- **Messages enumerate sets.** *"no write schema accepts [a, b]"* becomes *"[a, b, c]"*
  the moment a third column goes missing — a different string, so two already-known
  problems come back as new.

- **Type checkers name types in their messages.** `Argument of type 'Prospect' is not
  assignable to parameter of type 'Lead'`. Rename `Prospect` and every message mentioning
  it changes at once — so under message-identity a **pure rename** would retire hundreds
  of baselined fingerprints and introduce an equal number of new ones, blocking a refactor
  that changed no behavior. The only practical escape is re-baselining the lot, and a
  baseline you re-cut under pressure has stopped being a ratchet.

  So `tsc` and `mypy` key on the *shape* of the error — `file::code::message-with-the-type-names-redacted`
  (`adapters/typecheck-identity.js`). The full message is still carried for display; only
  identity is redacted. They include `file` in the key **explicitly**, because the keyed
  scheme drops it: a schema symbol should survive being moved to another file, but a type
  error is a fact about a place, and the same error in two files is two problems.

  The trade-off, stated plainly: two same-shaped errors of the same code in one file
  collapse to a single fingerprint. Counting (the diff engine compares occurrence counts,
  not set membership) means going from one to two still blocks; what is lost is knowing
  *which* of the two was fixed. That is much smaller than a baseline that dissolves on
  every refactor.

Absent a key, identity is exactly what it was in v2.5.2 — **byte for byte**, asserted
against literal digests, because every baseline in every repo is a map keyed by these
hashes.

---

## See also

- [`contract-guide.md`](../api/contract-guide.md) — what the contract check does
- [`upgrade-guide.md`](../procedures/upgrade-guide.md) — v2.6.0 upgrade + error catalog
