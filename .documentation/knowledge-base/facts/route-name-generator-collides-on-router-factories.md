---
title: "`generate_unique_id_function=lambda route: route.name` collides on router
  factories, producing an invalid OpenAPI document"
tier: fact
domains:
  - api
status: active
last_updated: 2026-09-01T00:00:00.000Z
id: route-name-generator-collides-on-router-factories
confidence: high
last_verified: 2026-09-01T00:00:00.000Z
verify_command: >
  #!/usr/bin/env bash

  set -euo pipefail

  python -c "

  from fastapi import APIRouter, FastAPI

  def build(gen):

      app = FastAPI(generate_unique_id_function=gen)

      for coach in ('annie', 'lenny', 'sid'):

          r = APIRouter(prefix='/' + coach, tags=['coach'])

          @r.get('/health')

          async def health_check(): ...

          app.include_router(r)

      import warnings

      with warnings.catch_warnings():

          warnings.simplefilter('ignore')

          doc = app.openapi()

      return [o['operationId'] for m in doc['paths'].values() for o in m.values()]

  bad = build(lambda r: r.name)

  assert len(set(bad)) < len(bad), 'expected the recommended-until-2.9.0 form to
  collide'

  print('CONFIRMED: route.name collapses', len(bad), 'operations onto',
  len(set(bad)), '->', sorted(set(bad)))

  good = build(lambda r: f'{sorted(r.methods)[0].lower()}_{r.path}')

  assert len(set(good)) == len(good), 'the replacement must not collide'

  print('CONFIRMED: the method+path form is collision-free ->', sorted(good))

  "
provenance:
  - sources/gimme-the-lint-issue-14
sources:
  - python/gtl_contract/openapi.py
  - python/gtl_contract/rules.py
  - python/tests/test_operation_id_advice_runs.py
tags:
  - fastapi
  - openapi
  - codegen
  - operation-id
invalidated_by:
  - FastAPI making duplicate operationIds an error rather than a warning
  - A future FastAPI in which `route.name` is no longer the handler `__name__`
last_validated: 2026-09-01
---

# `generate_unique_id_function=lambda route: route.name` collides on router factories

## Claim

Setting FastAPI's `generate_unique_id_function` to `lambda route: route.name` produces
**duplicate `operationId`s** on any codebase that builds routers from a factory — a normal
FastAPI pattern.

`route.name` is the handler's `__name__`. A factory like `make_coach_router()` stamps the
same handler names into every router it produces, so all of them collide.

Duplicate `operationId`s make the OpenAPI document **invalid**. A code generator either
collides or silently drops all but one, so a client compiles fine against an endpoint it
can no longer call.

## Provenance

This was **our own recommended fix**, emitted by `openapi/unstable-operation-id` and
printed in three documents, from 2.6.0 through 2.8.2.

On the reporting codebase (248 routes, FastAPI): **15 routes collapsed onto 5
`operationId`s** — `health_check`, `create_session`, `stream_chat`, `get_sessions`,
`get_history`, each claimed three times by three AI-coach routers built from one factory.

The rule's recommended fix caused the exact class of harm the rule exists to prevent.

## How to verify

The `verify_command` builds two routers from one factory and asserts the collision. It
also checks the replacement recommendation is collision-free on the same shape.

## Consequences

FastAPI *does* emit a `UserWarning` per duplicate at document-build time. It scrolls past
in startup output nobody reads — which is the same reason every rule in this catalogue
exists.

Since **2.9.0** the collision is caught by `openapi/duplicate-operation-id`. It is
**debt**, not a defect, for an unusually direct reason: FastAPI's default generator
includes the path and never collides, so a duplicate is almost always the fingerprint of a
custom generator — most often the one we recommended. Blocking a patch upgrade for people
who collided by following our own documented advice would be indefensible.

## The form to use instead

```python
FastAPI(generate_unique_id_function=lambda r: f"{sorted(r.methods)[0].lower()}_{r.path}")
```

Method plus path is what makes an operation unique in an OpenAPI document to begin with,
so it cannot collide, and it is the only form actually decoupled from Python identifiers.

A tag-qualified form (`"_".join([*r.tags, r.name])`) reads better and is safe on untagged
routes, but it is unique only if your tags distinguish your routers — three routers
sharing one `coach` tag still collide.

> ⚠️ `f"{route.tags[0]}_{route.name}"` raises `IndexError` on any untagged route. Use the
> `join` form if you want the tag-qualified shape.

## See also

- [operationId derives from the function name](fastapi-operation-ids-derive-from-function-names.md)
- [Contract Rules](../../standards/contract-rules-guide.md) — `openapi/duplicate-operation-id`
- [Generated Client Types](../../api/codegen-guide.md)
