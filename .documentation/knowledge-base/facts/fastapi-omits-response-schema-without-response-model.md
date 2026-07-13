---
title: A FastAPI route with no response_model emits an EMPTY response schema,
  and codegen types it `any`
tier: fact
domains:
  - api
status: active
last_updated: 2026-07-13T00:00:00.000Z
id: fastapi-omits-response-schema-without-response-model
confidence: high
last_verified: 2026-07-13T00:00:00.000Z
verify_command: >
  #!/usr/bin/env bash

  set -euo pipefail

  python -c "

  from fastapi import FastAPI

  app = FastAPI()

  @app.get('/deals')

  def list_deals():           # no response_model, no return annotation
      return [{'id': '1'}]
  spec = app.openapi()

  ok = spec['paths']['/deals']['get']['responses']['200']

  schema = ok.get('content', {}).get('application/json', {}).get('schema')

  print('200 response schema ->', schema)

  assert not schema, 'expected an EMPTY schema — FastAPI cannot infer one'

  print('CONFIRMED: the spec describes nothing; a generator will type this
  `any`')

  "
provenance:
  - sources/gimme-the-lint-v2.7.0-validation
sources:
  - python/gtl_contract/openapi.py
tags:
  - fastapi
  - openapi
  - codegen
  - silent-failure
invalidated_by:
  - Adding `response_model=` to the route
  - Adding a concrete return annotation — FastAPI will derive the schema from it
word_count: 313
estimated_read_time: 2 minutes
last_validated: 2026-07-13
---

# A FastAPI route with no response_model emits an EMPTY response schema, and codegen types it `any`

## Claim

FastAPI **cannot infer a response schema from a function that does not declare one**. Given
neither a `response_model=` nor a concrete return annotation, it emits a `200` with an
**empty schema**.

The route still works. The spec still validates. And it describes **nothing**.

## How to verify

Declare a route with no `response_model` and no return type, then read the OpenAPI document
the app produces. The `200` is there; the schema under it is empty.

On the codebase this was found in: **48 of 243 routes** — a fifth of the API.

## Consequences

**A perfect lockfile over an incomplete spec is a perfect record of a lie.**

Everything downstream inherits the omission, and inherits it *silently*:

- A code generator has nothing to work from, so it types the entire endpoint **`any`**.
  Your client compiles happily against a shape **nobody has ever checked**.
- The breaking-change diff has nothing to compare, so no change to that endpoint can ever
  be *detected* as breaking.
- You can have a green lockfile check, a green codegen check, and **no idea what a fifth of
  your API returns.**

This is the rule (`openapi/route-without-response-model`) that determines whether
`codegen-drift` is guarding anything at all. It is **debt** — 48 findings on day one, and if
they blocked you would uninstall the tool rather than fix 48 routes before your next commit
— but until they are fixed, the guard downstream is green over `any`.

**Two fixes, either works:** `response_model=DealResponse`, or a concrete return annotation
(`-> DealResponse`). FastAPI will use the annotation if you give it one. Note that
`-> dict[str, Any]` technically satisfies FastAPI but generates `Record<string, unknown>`,
which is a schema in the same way that "an object, probably" is a schema.

## See also

- [Contract Rules](../../standards/contract-rules-guide.md) — `openapi/route-without-response-model`
- [Generated Client Types](../../api/codegen-guide.md)
- [fastapi-operation-ids-derive-from-function-names](fastapi-operation-ids-derive-from-function-names.md)
