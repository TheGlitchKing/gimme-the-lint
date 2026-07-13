---
title: A blank ZIP field for a release cycle, and a form field that never existed
tier: incident-narrative
domains:
  - incidents
  - api
status: resolved
last_updated: 2026-07-13T00:00:00.000Z
id: 2026-07-06-blank-zip-field-and-invented-columns
date: 2026-07-06T00:00:00.000Z
severity: medium
resolution_status: resolved
components:
  - frontend
  - backend-api
  - openapi-contract
tags:
  - contract-drift
  - codegen
  - silent-failure
  - hand-written-types
word_count: 566
estimated_read_time: 3 minutes
last_validated: 2026-07-13
---

# A blank ZIP field for a release cycle, and a form field that never existed

## Summary

Two bugs of the same species, found the same way: a human clicking around in a browser.

A prospect's ZIP code rendered as **blank** for a full release cycle. The component read
`prospect.zip`; the API returns `zip_code`. Nothing had failed — `undefined` renders as
nothing, and nothing looks exactly like *"the data was never saved."*

Separately, a hand-written `TaskFormData` declared a field called `estimated_hours`. No
such column exists. The real one is **`estimated_cost`** — one word away. It also declared
`dependencies`, which does not exist at all, while omitting `notes`, `deal_id`,
`estimated_cost` and `is_recurring`, all of which do. **Wrong in both directions
simultaneously**, and the compiler accepted it happily for as long as it existed.

## Timeline

- **Earlier** — the backend correctly names the column `zip_code`. The SQLAlchemy model,
  the Pydantic schemas, the database row and the OpenAPI document all agree.
- **Earlier** — a frontend component is written against `prospect.zip`. TypeScript does not
  object, because the type it is checked against is **also hand-written**.
- **A full release cycle** — users see a blank ZIP field. Nothing is logged. No error is
  raised. The API returns 200 with correct data in it.
- **2026-07-06** — a human notices the blank field in a browser and traces it back.
- **2026-07-13** — `codegen-drift` shipped (gimme-the-lint v2.7.0). The class of bug becomes
  inexpressible rather than merely detectable.

## Root cause

**Every guard we had was green, and every guard we had was looking at the wrong rung.**

```
   Postgres columns
        ⇕   alembic-check                       ✅ green
   SQLAlchemy models
        ⇕   17 contract rules                   ✅ green — ZERO violations on Task
   Pydantic schemas
        ↓   materialize → openapi.json          ✅ green, and fresh
   openapi.json
        ↓   [ nothing checked this ]            ❌
   frontend types                               ← the lie lived here
```

The backend was correct. It had **always** been correct. The entity-contract check reports
**zero violations** on `Task`, because the model and the schemas exposing it agree
perfectly.

The lie was entirely in the **hand-written mirror** — a TypeScript file that claims to
describe the API and is maintained by someone retyping it. That is the same disease this
whole tool exists to cure (*the same thing defined twice, drifting apart in silence*), one
layer further out than any of our checks were looking.

## Resolution

`codegen-drift` (v2.7.0). The client types are now **derived** from the lockfile rather
than retyped from it, and a stale generated type is `contract/codegen-stale` — a **defect**,
blocked, never baselineable.

With generated types:

- `prospect.zip` is a **compile error**: `Property 'zip' does not exist on type 'Prospect'`.
- `estimated_hours` is **inexpressible** — you cannot declare a field the API does not have.

## Lessons

1. **Drift lives wherever two artifacts must _agree_. It cannot exist where one is
   _derived_.** Every rung we had guarded was an *agreement* between two things maintained
   separately. The remaining rung was the one where we had simply asked a human to copy the
   truth accurately, forever.

2. **A green check on the layer below tells you nothing about the layer above.** The
   contract check being green on `Task` was *correct*, and it was *reassuring*, and it was
   *irrelevant* to the bug.

3. **`undefined` renders as nothing, and nothing looks like data that was never saved.**
   This is why the frontend rung is worth guarding specifically: its failures do not look
   like failures. They look like the user's fault.

4. **`estimated_hours` was not a typo.** It was a *plausible* field, one word from a real
   one, that somebody invented and nothing ever contradicted. Hand-maintained mirrors do not
   drift by degrading; they drift by inventing.

## See also

- [Generated Client Types](../../../api/codegen-guide.md)
- [fastapi-omits-response-schema-without-response-model](../../facts/fastapi-omits-response-schema-without-response-model.md)
- [fastapi-operation-ids-derive-from-function-names](../../facts/fastapi-operation-ids-derive-from-function-names.md)
