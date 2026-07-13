---
title: The Entity Contract
tier: guide
domains:
  - api
status: active
last_updated: 2026-07-13T00:00:00.000Z
version: 2.7.0
word_count: 819
estimated_read_time: 5 minutes
last_validated: 2026-07-13
---

# The Entity Contract

## The bug this exists to catch

A user fills in twelve fields on a form. Four of them are saved. The API returns `201
Created`.

Nothing crashed. Nothing was logged. The response said success, and it was lying —
because the database column existed, and the ORM model knew about it, but the Pydantic
schema that accepted the request **did not declare it**, and `extra='ignore'` dropped it
on the floor.

That is contract drift, and it is expensive precisely because it is *silent*. A model
and the schemas that expose it are two descriptions of the same thing. When they
disagree, the application does not fall over — it quietly saves the wrong data, returns
the wrong shape, or drops a field and reports success. Nobody finds out until a user
notices their work is gone.

## What gimme-the-lint checks

Your **persistence model** (a SQLAlchemy table) and your **transport schemas** (the
Pydantic `Create` / `Update` / `Response` objects that expose it) must agree.

```
  Deal (table)                DealCreate     DealUpdate     DealResponse
  ├── deal_id                                                    ✓
  ├── name                        ✓              ✓               ✓
  ├── purchase_price              ✓              ✗  ← settable, never changeable
  └── operating_expenses          ✗              ✗               ✗  ← invisible
                                  ↑
                     a client sends it, gets a 201, and the value is discarded
```

Seventeen rules, each of which exists because of a specific production bug. See
[`contract-rules-guide.md`](../standards/contract-rules-guide.md).

## Debt and defects

The check is **progressive**, like every other linter here: existing violations are
grandfathered, and only new ones block. That is what makes it possible to adopt on a
codebase that already has hundreds.

But one class is **never** grandfathered.

| | means | baselineable? |
|---|---|---|
| **debt** | a gap. The app works; it has a hole in it. | **yes** — that is what progressive linting is *for* |
| **defect** | broken **right now**, for everyone, regardless of what anyone does next | **never** |

The predicate is **not** "does it return a 500". `contract/update-has-create-default`
returns a cheerful **200** while overwriting the user's stored data on every save.
That is *worse* than a 500 — because a 500 is loud.

A defect can still be **excepted**, in `.gtl/config.js`, with a mandatory reason. Nobody
is going to type *"we accept that GET /conversations returns 500 for every user."*
**The friction is the feature.** See
[`decision-vs-debt-guide.md`](../standards/decision-vs-debt-guide.md).

## When it runs

**On push, not on commit.**

The checker imports your application — it has to, see below — and that costs seconds.
Seconds are fine once per push. They are not fine on every commit, and a three-second
pre-commit hook is a hook people turn off. A disabled hook guards nothing at all.

This is a better fit rather than a compromise: the check was never file-scoped. It
inspects your whole model layer at once, so "lint only the staged files" was never a
meaningful operation for it.

## Why it imports your app instead of reading your files

Because the authoritative list of *what a client can write* lives in the **route table**,
not in the filenames.

Write schemas are conventionally named `XCreate` / `XUpdate`. But the ones that **aren't**
are precisely the ones nobody has audited. `UpdateTierRequest` writes
`organizations.tier`. `AssetFolderCreateRequest` writes `asset_folders`. Neither is
called `OrganizationUpdate`, so a name-based static scan reports both tables as having
*no client write surface* and moves on.

**A scan whose miss is invisible to itself is worse than no scan, because it is
believed.** So we import, and read the route table the framework actually built.

## A skip is not a pass

Importing is genuinely risky: a missing venv, an absent library, a model module that
opens a database connection at import time. Every one of those resolves to a **skip** —
loud, explained, and never blocking.

**A skip means UNCHECKED, not CLEAN.** "We looked and found nothing" and "we could not
look" are the same number of violations and opposite facts. Collapsing them would let a
broken import masquerade as a clean bill of health — a guard reporting green while
guarding nothing, which is the exact failure this whole tool exists to eliminate.

So `check` prints `⚠ SKIPPED` with the reason and the traceback, and the commit
proceeds. If you see one, the contract was **not** verified.

## Setup

```bash
gimme-the-lint install     # installs gtl-contract into your venv
gimme-the-lint hooks       # pre-commit + pre-push
gimme-the-lint baseline    # grandfather existing debt (defects are refused, loudly)
```

Configure the app it should import, in `.gtl/config.js`:

```js
module.exports = {
  contract: {
    models:  ['app.models'],                 // populates the ORM registry
    schemas: ['app.schemas', 'app.routers'], // NOT just schemas/ — see below
    app:     'app.main:app',                 // the route table
  },
};
```

`schemas` is deliberately plural and deliberately includes `routers`. Real applications
keep write schemas next to the routes that use them, and an inventory that only looked
in the obvious place would under-report — which is the exact failure mode it exists to
prevent.

## Providers

| provider | persistence | transport |
|---|---|---|
| `sqlalchemy+pydantic` | SQLAlchemy | Pydantic `Create`/`Update`/`Response` (FastAPI) |

The generic shape is **persistence model ↔ transport schemas**, so Django+DRF,
Prisma+zod and TypeORM+class-validator fit the same frame. Adding one means adding a
module and a registry entry.

A few rules are stack-specific — the `metadata` / `Base.metadata` collision is purely
SQLAlchemy. That is expected: **rules belong to the provider, exactly as ESLint's rules
belong to ESLint.**

## See also

- [`contract-rules-guide.md`](../standards/contract-rules-guide.md) — every rule and its incident
- [`decision-vs-debt-guide.md`](../standards/decision-vs-debt-guide.md) — what can and cannot be baselined
- [`schema-lockfile-guide.md`](schema-lockfile-guide.md) — the API contract lockfile
- [`architecture-guide.md`](../architecture/architecture-guide.md) — where the code lives and why
- [`contract-troubleshooting-guide.md`](../troubleshooting/contract-troubleshooting-guide.md) — when it won't run
