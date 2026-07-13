---
title: FastAPI derives operationId from the function name, so renaming a handler
  is a breaking API change
tier: fact
domains:
  - api
status: active
last_updated: 2026-07-13T00:00:00.000Z
id: fastapi-operation-ids-derive-from-function-names
confidence: high
last_verified: 2026-07-13T00:00:00.000Z
verify_command: >
  #!/usr/bin/env bash

  set -euo pipefail

  python -c "

  from fastapi import FastAPI

  app = FastAPI()

  @app.get('/prospects/{id}')

  def get_prospect(id: str): ...

  spec = app.openapi()

  op = spec['paths']['/prospects/{id}']['get']['operationId']

  print('operationId ->', op)

  assert 'get_prospect' in op, 'the FUNCTION NAME is embedded in the public
  contract'

  print('CONFIRMED: rename the Python function and every generated client method
  renames')

  "
provenance:
  - sources/gimme-the-lint-v2.7.0-validation
sources:
  - python/gtl_contract/openapi.py
  - python/gtl_contract/rules.py
tags:
  - fastapi
  - openapi
  - codegen
  - breaking-change
invalidated_by:
  - Setting `generate_unique_id_function` at app construction, which overrides
    the default
  - FastAPI changing its default operationId strategy
word_count: 273
estimated_read_time: 2 minutes
last_validated: 2026-07-13
---

# FastAPI derives operationId from the function name, so renaming a handler is a breaking API change

## Claim

By default, FastAPI builds each route's `operationId` from the **Python function name**,
the path, and the method — e.g. `get_prospect_prospects__id__get`.

Code generators turn `operationId` into the **client method name**.

Therefore: **renaming a Python handler renames every generated client method that calls
it.** A pure refactor, touching no API surface, ships as a breaking change to every
consumer.

## How to verify

Define one route, ask the app for its OpenAPI document, and read the `operationId`. The
function name is right there, embedded in the public contract. The `verify_command` above
does it in six lines.

On the codebase this was found in: **243 of 243 routes** relied on the auto-derived form.
100%.

## Consequences

The failure mode is invisible from inside the repo. Your tests pass, your types compile,
your API behaves identically — and every downstream SDK breaks on the next release, for a
change that was never an API change at all.

It also makes the whole codegen chain fragile: the generated client is keyed on identifiers
that nobody thinks of as public, and that everybody renames freely.

**The fix is one line, at app construction, and it fixes every route at once:**

```python
FastAPI(generate_unique_id_function=lambda route: route.name)
```

That pins `operationId` to the route's declared name rather than the function's identifier —
so a refactor stays a refactor.

This is `openapi/unstable-operation-id`. It is **debt** (243 findings on day one; if it
blocked, nobody would adopt the tool), but it caps the value of everything downstream of
the lockfile.

## See also

- [Contract Rules](../../standards/contract-rules-guide.md) — `openapi/unstable-operation-id`
- [Generated Client Types](../../api/codegen-guide.md)
- [fastapi-omits-response-schema-without-response-model](fastapi-omits-response-schema-without-response-model.md)
