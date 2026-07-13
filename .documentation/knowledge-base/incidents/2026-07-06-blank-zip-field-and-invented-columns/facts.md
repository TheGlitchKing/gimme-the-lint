---
title: Facts from 2026-07-06 blank-zip-field-and-invented-columns
tier: incident-facts
domains:
  - incidents
status: active
last_updated: 2026-07-13T00:00:00.000Z
incident_id: 2026-07-06-blank-zip-field-and-invented-columns
produced:
  - hand-written-client-types-drift-by-inventing
strengthened:
  - fastapi-omits-response-schema-without-response-model
  - fastapi-operation-ids-derive-from-function-names
word_count: 231
estimated_read_time: 2 minutes
last_validated: 2026-07-13
---

# Facts from 2026-07-06 blank-zip-field-and-invented-columns

## Produced

- `hand-written-client-types-drift-by-inventing` — `TaskFormData` did not merely fall
  *behind* the API; it declared `estimated_hours` and `dependencies`, **neither of which
  has ever existed**. A hand-maintained mirror does not drift by degrading. It drifts by
  inventing, and nothing contradicts it.

## Strengthened

- `fastapi-omits-response-schema-without-response-model` — investigating the incident
  measured the blast radius: **48 of 243 routes** emit an empty response schema. Any
  generated client types those endpoints `any`, so the very fix for this incident would
  have been guarding a fifth of the API with the word `any`. Confidence raised from
  hypothesis to **high**, with a count.

- `fastapi-operation-ids-derive-from-function-names` — **243 of 243 routes** rely on the
  auto-derived form. Confirmed at 100% on a real codebase, not inferred from the docs.

## Evidence

The decisive measurement was generating TypeScript from the real API and comparing it
against the hand-written types:

| field | in the real API? | `TaskFormData` says |
|---|---|---|
| `estimated_hours` | **no** (0 occurrences) | declares it |
| `dependencies` | **no** (0 occurrences) | declares it |
| `estimated_cost` | yes (3) | omits it |
| `notes` | yes (47) | omits it |
| `deal_id` | yes (26) | omits it |
| `is_recurring` | yes (3) | omits it |

And the entity-contract check reports **zero violations** on `Task`. The backend was
correct throughout. The check that would have caught this did not exist, and every check
that did exist was green.
