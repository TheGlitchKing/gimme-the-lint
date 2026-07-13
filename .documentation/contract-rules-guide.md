# Contract Rules

Seventeen rules. **Every one of them exists because of a specific production bug** —
the incident is recorded with the rule, in code, and printed by `gtl-contract rules`.
A rule whose reason is written down is a rule nobody deletes in a hurry.

Rules split two ways, and the split decides whether you can grandfather them:

- **debt** — a gap. The app works; it has a hole in it. **Baselineable.**
- **defect** — broken *right now*, for everyone. **Never baselineable.**

The predicate is **not** "does it return a 500" — see
[`decision-vs-debt-guide.md`](decision-vs-debt-guide.md).

---

## Debt — baselineable

### `contract/column-not-writable`

A column exists that **no write schema accepts**, so a client can never save it.

> **The bug:** a user filled in twelve fields on the property form and four were
> persisted. `PropertyCreate` declared 17 of 37 columns; `extra='ignore'` dropped the
> rest and the API returned **201**. Silent data loss, confirmed as success.

**Fix:** add it to the write schema. **Or:** declare it in `serverManaged` (a client
must never set it) or `intentionallyAbsent` (with a reason).

---

### `contract/column-not-readable`

A column the response schema never returns, so no client can read it.

> **The bug:** `ProjectEvent.phase_id` was a real, indexed foreign key that no
> standalone schema exposed. You could not set an event's phase, change it, or even
> *read* which phase it was in.

---

### `contract/create-update-disagree`

A field exists on create but not update (or vice versa) without being declared.

> **The bug:** the Deal schemas each omitted 17-19 columns — every buy-and-hold
> operating expense. Zero deals in the database had ever persisted one.

**Fix:** make them agree. **Or:** if the field is genuinely immutable, say so in
`intentionallyAbsent` with a reason ("a line item cannot be moved between projects").

---

### `contract/write-schema-not-strict`

A write schema does not set `extra='forbid'`, so an unknown key is silently discarded.

> **This is the MECHANISM behind every other rule here.** With `extra='ignore'`, a
> typo'd or renamed field is accepted, dropped, and confirmed with a 201.

**Load-bearing debt.** While this is unfixed, the other rules are advisory: the runtime
will keep quietly accepting things it does not understand. Fix it first.

---

### `contract/unregistered-write-surface`

A request body the API accepts, covered by no entity contract.

> **The bug:** four entities nobody knew were entities. Their schemas lived in
> `routers/` rather than `schemas/`, so a scan of the obvious place missed them
> entirely — a blind spot invisible to itself.

Found by reading the **route table**, not by matching names. `UpdateTierRequest` writes
`organizations.tier` and is called nothing of the sort.

**Fix:** if it writes a table, give that model real `Create`/`Update` schemas. If it
writes no table (a calculator input, an auth flow, a search query), pin it in
`unauditedRequestBodies` — **a ratchet that may shrink and never grow.**

---

### `contract/duplicate-schema-class`

The same schema class name defined in two modules, with **identical** fields.

Harmless twins today, drift tomorrow. Nobody writes this on purpose; it happens because
two people each needed a response shape and neither knew the other existed.

---

### `contract/unimportable-module`

A module in your models/schemas package cannot be imported.

> **The bug, found on the very first run against a real codebase:**
> `app/models/folder.py` was a backward-compat shim re-exporting a `Folder` model that
> had been renamed away years earlier. Nothing imported it, so it rotted in silence —
> and would have exploded the instant anyone touched it.

Two things are wrong, and the second is the one that matters here: **any models inside
that module are invisible to the contract check.** They are not clean — they are
*unchecked*. The rule gives the blind spot a name.

---

### `contract/lockfile-missing`

A code-first API with no materialized contract. See
[`schema-lockfile-guide.md`](schema-lockfile-guide.md).

**Debt on purpose:** every FastAPI project on earth starts without one. If this could
not be grandfathered, nobody could install the tool without first materializing — and a
linter you must repair your repo to install is a linter nobody installs.

**Fix:** `gimme-the-lint materialize`.

---

## Defects — never baselineable

### `contract/reserved-metadata-unaliased`

A response field named `metadata` with no alias onto a real column.

> **The bug:** `metadata` is **reserved** on every SQLAlchemy declarative model —
> `Base.metadata` *is* the MetaData registry, so `hasattr(Model, 'metadata')` is always
> True. `ConversationResponse.metadata` had no alias, so reading any conversation
> returned the registry object instead of a dict. **A 500 on GET and PUT, for every
> conversation, forever.**

**Fix:** alias it onto the real column — `Field(validation_alias='meta_config')`. The
column itself can never be called `metadata`.

---

### `contract/update-has-create-default`

An update schema carries a non-`None` default.

> **The bug:** `BudgetLineItemUpdateNested` had `status = "pending"` and `notes = None`.
> An update schema is applied **over an existing row**, so a field the client did not
> send materialized as its default and overwrote what the user had stored. Opening a
> project and clicking Save reset every approved line item to `pending` and wiped its
> notes. **The user changed nothing. It returned 200.**

**This is why the predicate is not "returns a 500".** A 200 that destroys your data is
worse than a 500, because a 500 is loud.

`None` defaults are fine — `exclude_unset` distinguishes "not sent" from "explicitly
null". It is the **non-None** defaults that are loaded guns.

**Fix:** defaults belong on the `Create` schema only.

---

### `contract/response-type-mismatch`

A response field's type contradicts its column's type.

> **The bug:** `PropertyResponse.units_details` was typed `str` against a JSON column.
> Harmless right up until someone wrote **correct** data into it — at which point every
> GET raised `ResponseValidationError` and the entire Portfolio page 500'd.

**A landmine with a fuse.** Baselining it would suppress the only warning you get before
it detonates.

---

### `contract/response-inherits-write-validator`

A write-side validator inherited onto a response schema, so it runs on **reads**.

> **The bug:** the read path must never reject data the database already contains. A
> validator on a shared base runs on every read, so one legacy row with an unexpected
> value 500s the endpoint returning it.

**Fix:** write validators belong on the write-only subclass.

---

### `contract/duplicate-schema-class-drifted`

The same schema class name in two modules, with **different** fields.

> **The bug:** `DocumentResponse` existed in both `app/routers/documents.py` and
> `app/schemas/deal.py` with different fields — so **which document shape a client got
> depended on which endpoint it happened to hit.**

Not a gap: an application that is already lying to somebody.

---

### `contract/exception-without-reason`

A declared exception with no reason, or a reason that says nothing.

> **An unexplained omission is indistinguishable from the bug it is hiding.**

The reason is how tacit knowledge ("why can't you change an event's type?") gets written
down instead of living in one person's head until they leave. Minimum 15 characters —
`n/a`, `TODO` and `legacy` are not reasons.

Baselining this rule would defeat it entirely.

---

### `contract/stale-exception`

An exception naming a model or column that no longer exists.

> **The bug, found twice on the first real codebase:** `Deal.user_id` and
> `Property.user_id` were declared `server_managed` years after the columns were
> removed.

Not cosmetic. **A dead declaration is a live exemption.** The day someone re-adds a
`user_id` column, it arrives pre-exempted from the contract and the guard stays quiet. A
stale exception quietly loosens the ratchet.

---

### `contract/lockfile-stale`

The committed API contract no longer matches the code.

> **The inert-guard case.** Change a schema without regenerating, and the lockfile goes
> on asserting an API you no longer serve — so the breaking-change check downstream
> compares two identical stale files and cheerfully reports no breakage. **The guard
> goes inert and still shows green.**

This is `npm ci` refusing a stale `package-lock.json`, for exactly the same reason.

**Fix:** `gimme-the-lint materialize`.

---

### `contract/spec-implementation-mismatch`

A **hand-authored** API spec that no longer describes what the code serves.

The declared-vs-actual problem, one level up from the database. A spec that has quietly
stopped matching the implementation is worse than no spec: clients are generated from
it, contracts are negotiated on it, and all of it is now fiction.

**Neither file is overwritten** — a spec you wrote is your source of truth and is never
ours to rewrite. The disagreement is reported; you decide which side is wrong.

---

### `contract/codegen-missing`

A generator is configured for your client types, but the output has never been written.

**Debt on purpose:** every repo starts here. **Fix:** `gimme-the-lint materialize`.

---

### `openapi/route-without-response-model`

A route that declares no `response_model`, so its response schema is **empty**.

> **48 of 243 routes** on the first real codebase. FastAPI cannot infer a response schema
> from a function that does not declare one, so it emits an empty one — and everything
> downstream inherits the lie. A code generator has nothing to work from and types the
> whole endpoint `any`, so your client compiles happily against a shape **nobody has ever
> checked**.

You can have a fresh lockfile, a green codegen check, and no idea what a fifth of your API
returns. **A perfect lockfile over an incomplete spec is a perfect record of a lie.**

**Fix:** add `response_model=...` to the route (or a return annotation — FastAPI will use
that too).

---

### `openapi/unstable-operation-id`

A route relying on FastAPI's auto-derived `operationId`.

> **243 of 243 routes** on the first real codebase. Generators turn `operationId` into the
> client *method name*, and FastAPI derives `operationId` from the **function name**. So
> renaming a Python handler — a pure refactor, touching no API surface — silently renames
> every generated client method that calls it, and **ships as a breaking change to every
> consumer**.

**Fix — one line, repo-wide:**

```python
FastAPI(generate_unique_id_function=lambda route: route.name)
```

---

## Defects — never baselineable (continued)

### `contract/codegen-stale`

The committed client types no longer match the lockfile.

> **The bug:** a component read `prospect.zip`; the API returns `zip_code`. Backend
> correct, contract check green, lockfile fresh, database row right — and the user saw a
> **blank ZIP field for a full release cycle**, because `undefined` renders as nothing, and
> nothing looks exactly like *"the data was never saved."*

A stale generated type is not a *gap*. It is **a lie the compiler is currently believing**.

**Fix:** `gimme-the-lint materialize`. If the file is hand-written, `materialize` will
**refuse** to overwrite it — and that refusal is correct. See
[`codegen-guide.md`](codegen-guide.md).

---

## Migration rules

### `migration/model-not-migrated` (external tier — CI only)

Your models and your migration head disagree: a migration is missing.

> Your tests pass because the test database is built **from the models**. Production is
> built **from the migrations**. They now disagree, and the deploy will find out.

**Never baselineable.** "We accept that our models and our production schema disagree"
is not a sentence anyone means. It is not debt; it is a deploy that has not failed yet.

Runs only in `gimme-the-lint verify` — it needs a live database, and a pre-commit hook
that dials a database fails on an aeroplane.

### `squawk/*`

Migration **safety**: which operations take a table-locking hold on production.

> `ALTER TABLE deals ADD COLUMN notes text NOT NULL DEFAULT '';` is fine on your laptop,
> fine in CI, fine in staging with its four hundred rows — and takes an ACCESS EXCLUSIVE
> lock on forty million rows in production, pinning every read and write behind it. The
> deploy "succeeds". The site is down.

Nothing about the SQL is malformed, so a syntax linter has nothing to say.

**Baselineable** — a dangerous migration that already shipped took its lock in the past.
A *new* one blocks.

---

## Seeing the catalogue yourself

```bash
gtl-contract rules | jq
```

Every rule ships with the incident it stands on. If you are about to disable one, read
its incident first.
