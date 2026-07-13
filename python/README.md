# gtl-contract

The entity-contract checker for [gimme-the-lint](https://github.com/TheGlitchKing/gimme-the-lint).

A model and the schemas that expose it are two descriptions of the same thing. When
they disagree, the application does not crash — it quietly saves the wrong data,
returns the wrong shape, or drops a field and answers `201`. That silence is what
makes contract drift expensive: nobody finds it until a user notices their work is
gone.

This package reads an application and reports where the two descriptions have come
apart.

## What it is (and is not)

`gtl-contract` is a **linter**. It knows nothing about baselines, fingerprints, git,
or `.gtl/` — it reads an app and prints violations as JSON. Everything progressive
(is this new? was it grandfathered? has it been fixed?) happens in the
gimme-the-lint engine that calls it, which treats this output exactly as it treats
ruff's or eslint's.

You do not normally invoke it yourself. `gimme-the-lint` does, on `pre-push`.

## Why it imports your app instead of parsing it

Because the authoritative list of *what a client can write* lives in the route
table, not in the filenames.

Write schemas are conventionally named `XCreate` / `XUpdate` — but the ones that
**aren't** are precisely the ones nobody has audited. `UpdateTierRequest` writes
`organizations.tier`. `AssetFolderCreateRequest` writes `asset_folders`. Neither is
called `OrganizationUpdate`, so a name-based static scan reports both tables as
having *no client write surface* and moves on.

A scan whose miss is invisible to itself is worse than no scan, because it is
believed. So we import, and read the route table the framework actually built.

## Skipping is not passing

The cost of importing is real: a missing venv, an absent library, a model module
that opens a database connection at import time. Every one of those resolves to a
**skip** — loud, explained, and never blocking.

A skip means **unchecked**, not **clean**. Zero violations because we looked and
found none, and zero violations because we could not look, are the same number and
opposite facts. The JSON says which:

```json
{ "checked": true,  "violations": [] }              // genuinely clean
{ "checked": false, "skip": "...", "detail": "..." } // we could not see your app
```

## The rules

Every rule exists because of a specific production bug. `gtl-contract rules` prints
the catalogue, including the incident each one stands on.

| | rule | catches |
|---|---|---|
| debt | `column-not-writable` | a column no write schema accepts — the client's value is dropped, and the API returns 201 |
| debt | `column-not-readable` | a column no response returns — no client can ever read it |
| debt | `create-update-disagree` | a field you can set but never change, undeclared |
| debt | `write-schema-not-strict` | `extra='ignore'` — the mechanism that makes every other bug here silent |
| debt | `unregistered-write-surface` | a request body covered by no contract |
| debt | `duplicate-schema-class` | one class name, two modules, identical fields |
| **defect** | `reserved-metadata-unaliased` | `metadata` reads SQLAlchemy's `MetaData` registry — 500 on every read, forever |
| **defect** | `update-has-create-default` | an update schema's default overwrites stored data. Returns 200 while destroying it |
| **defect** | `response-type-mismatch` | a JSON column typed `str` — a landmine with a fuse |
| **defect** | `response-inherits-write-validator` | a write validator on the read path: one legacy row 500s the endpoint |
| **defect** | `duplicate-schema-class-drifted` | one class name, two modules, **different** fields |
| **defect** | `exception-without-reason` | an unexplained omission is indistinguishable from the bug |
| **defect** | `stale-exception` | an exception naming something that no longer exists |

**Debt** is baselineable: grandfather it, and only NEW instances block. That is what
progressive linting is for.

**Defects** are not. They are broken *right now*, for everyone, regardless of what
anyone does next — so they can never be silently grandfathered. The predicate is not
"returns a 500": `update-has-create-default` returns a cheerful 200 while wiping the
user's data, which is worse, because a 500 is loud.

A defect can still be **excepted** — in `.gtl/config.js`, with a mandatory reason.
Nobody is going to type *"we accept that GET /conversations returns 500 for every
user."* The friction is the feature.

## Providers

| provider | persistence | transport |
|---|---|---|
| `sqlalchemy+pydantic` | SQLAlchemy | Pydantic `Create`/`Update`/`Response` (FastAPI) |

The generic shape is **persistence model ↔ transport schemas**, so Django+DRF,
Prisma+zod and TypeORM+class-validator fit the same frame. Adding one means adding a
module and a registry entry; nothing else changes.

A few rules are stack-specific — the `metadata` / `Base.metadata` collision is purely
SQLAlchemy. That is fine, and expected: rules belong to the provider, exactly as
ESLint's rules belong to ESLint.

## Dependencies

None, deliberately. `gtl-contract` inspects *your* SQLAlchemy models and *your*
Pydantic schemas, using the versions your app already pins. Declaring `sqlalchemy>=2`
here could drag a second, different SQLAlchemy into the venv and inspect a registry
your application never populated — and then report confidently on a model layer that
does not exist.

## CLI

```bash
gtl-contract check --root . --config .gtl/contract.json
gtl-contract rules
```

`stdout` is JSON and only JSON. Anything else on it makes this unparseable, and an
unparseable linter is a silently absent one.

## License

MIT
