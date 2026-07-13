---
title: Hand-written client types do not drift by degrading — they drift by inventing
tier: fact
domains:
  - api
  - architecture
status: active
last_updated: 2026-07-13T00:00:00.000Z
id: hand-written-client-types-drift-by-inventing
confidence: high
last_verified: 2026-07-13T00:00:00.000Z
verify_command: >
  #!/usr/bin/env bash

  set -euo pipefail

  # Generate the truth from the API, then ask whether the hand-written type's
  fields exist.

  # Any field with 0 occurrences was INVENTED — it has never existed in the API.

  bash -c '

  set -e

  npx --yes openapi-typescript openapi.json -o /tmp/truth.ts 2>/dev/null

  for f in $(grep -oE "^\s+[a-z_]+\??:" frontend/src/types/forms.ts | tr -d "
  ?:" | sort -u); do
    n=$(grep -c "\b$f\b" /tmp/truth.ts || true)
    [ "$n" -eq 0 ] && echo "INVENTED: $f — no such field in the API"
  done

  echo "(no output above = every hand-written field exists)"

  '
provenance:
  - incidents/2026-07-06-blank-zip-field-and-invented-columns/
sources:
  - lib/adapters/codegen-drift.js
tags:
  - codegen
  - contract-drift
  - silent-failure
invalidated_by:
  - The client types being generated rather than hand-written, which makes the
    failure inexpressible rather than merely detectable
word_count: 318
estimated_read_time: 2 minutes
last_validated: 2026-07-13
---

# Hand-written client types do not drift by degrading — they drift by inventing

## Claim

A hand-maintained type that mirrors a backend schema does not simply fall *behind* the API.
It acquires fields that **have never existed**, and nothing contradicts them.

The compiler cannot help: it is checking the code against the **hand-written type**, which
is the thing that is wrong.

## How to verify

Generate the types from the API's own OpenAPI document, then check every field the
hand-written type declares. A field with **zero occurrences** in the generated output was
invented — it is not stale, it is fiction.

The measurement that produced this fact:

| field | in the real API? | the hand-written type says |
|---|---|---|
| `estimated_hours` | **no** (0) | declares it |
| `dependencies` | **no** (0) | declares it |
| `estimated_cost` | yes (3) | omits it |
| `notes` | yes (47) | omits it |

Wrong in **both directions at once**.

## Consequences

`estimated_hours` is the detail to sit with. It is not a typo. It is a **plausible field,
one word away from a real one** (`estimated_cost`), that somebody invented and the type
system cheerfully accepted forever. A user typing an estimate into that form watched it
vanish, and the application reported success.

This is why the fix is **derivation**, not detection:

- With generated types, `prospect.zip` is a **compile error**.
- With generated types, `estimated_hours` is **inexpressible** — you cannot declare a field
  the API does not have.

> **Drift lives wherever two artifacts must _agree_. It cannot exist where one is
> _derived_.**

And it is why every other guard was green when this shipped: the backend was correct
throughout. The entity-contract check reports **zero violations** on the model in question.
A green check on the layer below tells you nothing about the layer above.

## See also

- [Generated Client Types](../../api/codegen-guide.md)
- [The incident](../incidents/2026-07-06-blank-zip-field-and-invented-columns/narrative.md)
