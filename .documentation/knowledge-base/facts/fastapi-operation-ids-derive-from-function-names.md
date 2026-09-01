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

  from starlette.routing import get_name

  route = [r for r in app.routes if getattr(r, 'path', None) ==
  '/prospects/{id}'][0]

  assert route.name == get_name(route.endpoint) == 'get_prospect', 'route.name IS
  the function name'

  print('CONFIRMED: rename the Python function and every generated client method
  renames')

  print('CONFIRMED: route.name is __name__, so it does NOT decouple anything')

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
  - "Setting `generate_unique_id_function` to a form keyed on the METHOD AND PATH.
    Note that `lambda route: route.name` does NOT invalidate this fact — route.name
    is the function name, so the coupling survives."

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

**The fix is one line, at app construction, and it fixes every route at once — but it
must be the right line:**

```python
FastAPI(generate_unique_id_function=lambda r: f"{sorted(r.methods)[0].lower()}_{r.path}")
```

Method plus path is what makes an operation unique in an OpenAPI document to begin with,
so this form **cannot collide**, and it is the only form genuinely decoupled from Python
identifiers — which is the entire point of the rule.

> ⚠️ **Corrected in 2.9.0.** This page previously recommended
> `lambda route: route.name`. That was wrong twice over, and it is worth knowing why
> because the mistake is easy to repeat:
>
> 1. **`route.name` IS the function name.** `starlette.routing.get_name(endpoint)`
>    returns `endpoint.__name__`, and `Route.__init__` assigns it to `self.name` when no
>    explicit name is given. So the line made the `operationId` stop *looking*
>    auto-derived — silencing this rule — while leaving the function-name coupling the
>    rule complains about entirely intact.
> 2. **It collides.** Router factories are a normal FastAPI pattern, and every router
>    built from one shares its handler names. Measured on the reporting codebase: **15
>    routes onto 5 `operationId`s**. Duplicates make the document invalid.
>
> See [`route.name` collides on router factories](route-name-generator-collides-on-router-factories.md).
> The collision is now caught by `openapi/duplicate-operation-id`.

A tag-qualified form (`"_".join([*r.tags, r.name])`) reads better than the path form and
is safe on untagged routes, but it is only unique if your tags actually distinguish your
routers — three routers sharing one `coach` tag still collide — and it is still derived
from the function name.

This is `openapi/unstable-operation-id`. It is **debt** (243 findings on day one; if it
blocked, nobody would adopt the tool), but it caps the value of everything downstream of
the lockfile.

## See also

- [Contract Rules](../../standards/contract-rules-guide.md) — `openapi/unstable-operation-id`
- [Generated Client Types](../../api/codegen-guide.md)
- [fastapi-omits-response-schema-without-response-model](fastapi-omits-response-schema-without-response-model.md)
