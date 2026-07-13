---
title: A non-None default on an update schema overwrites stored data, and returns 200
tier: fact
domains:
  - api
  - database
status: active
last_updated: 2026-07-13T00:00:00.000Z
id: update-schema-defaults-overwrite-stored-data
confidence: high
last_verified: 2026-07-13T00:00:00.000Z
verify_command: |
  #!/usr/bin/env bash
  set -euo pipefail
  python -c "
  from typing import Optional
  from pydantic import BaseModel
  class BudgetLineItemUpdate(BaseModel):
      status: str = 'pending'      # the loaded gun
      notes: Optional[str] = None  # harmless
  stored = {'status': 'approved', 'notes': 'agreed with the contractor'}
  client_sent = {}                 # the user edited neither field
  payload = BudgetLineItemUpdate(**client_sent)
  naive = {**stored, **payload.model_dump()}
  print('stored :', stored)
  print('written:', naive)
  assert naive['status'] == 'pending', 'expected the default to clobber it'
  print('CONFIRMED: status was silently reset, and notes wiped, with a 200')
  "
provenance:
  - incidents/2026-05-01-budget-line-items-reset-on-save/
sources:
  - python/gtl_contract/providers/sqlalchemy_pydantic/checks.py
tags:
  - pydantic
  - data-loss
  - silent-failure
invalidated_by:
  - The service layer switching to `model_dump(exclude_unset=True)` everywhere,
    which would make the default unreachable for a field the client never sent
word_count: 256
estimated_read_time: 2 minutes
last_validated: 2026-07-13
---

# A non-None default on an update schema overwrites stored data, and returns 200

## Claim

An update schema is applied **over an existing row**. Any field carrying a **non-`None`
default** materializes as that default when the client omits it — and is then written on
top of whatever the user had stored.

The request succeeds. The response is **200**.

## How to verify

Construct the update schema with an empty payload — the client edited nothing — and look
at what `model_dump()` produces. The default is there, indistinguishable from a value the
user actually sent. Merge it over the stored row and the stored value is gone.

`None` defaults are **safe**: `exclude_unset` distinguishes *"not sent"* from *"explicitly
null"*, so an untouched field is never written. It is the **non-`None`** defaults that are
loaded guns.

## Consequences

This is the reason `contract/update-has-create-default` is a **defect** rather than debt,
and it is the sharpest illustration of why the never-baseline predicate is **not** "does
it return a 500".

> `BudgetLineItemUpdateNested` carried `status = "pending"` and `notes = None`. Opening a
> project and clicking **Save** reset every approved line item back to `pending` and wiped
> its notes. **The user changed nothing.** It returned 200.

A 500 is loud. Somebody pages. This is silent: the user's work is destroyed and the
application congratulates them. That is *worse*, and it is why "broken right now, for
everyone" — not "returns 5xx" — is the line that decides what can be grandfathered.

**Defaults belong on the `Create` schema only.**

## See also

- [Contract Rules](../../standards/contract-rules-guide.md) — `contract/update-has-create-default`
- [Decision vs Debt](../../standards/decision-vs-debt-guide.md)
