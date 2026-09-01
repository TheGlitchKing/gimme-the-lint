---
title: "FastAPI emits a phantom EMPTY application/json beside a described non-JSON
  response, unless response_class is set"
tier: fact
domains:
  - api
status: active
last_updated: 2026-09-01T00:00:00.000Z
id: fastapi-emits-a-phantom-empty-application-json
confidence: high
last_verified: 2026-09-01T00:00:00.000Z
verify_command: >
  #!/usr/bin/env bash

  set -euo pipefail

  python -c "

  from fastapi import FastAPI

  from fastapi.responses import StreamingResponse

  SSE = {200: {'content': {'text/event-stream': {'schema': {'type': 'object'}}}}}

  def media(**kw):

      app = FastAPI()

      @app.post('/stream', **kw)

      async def stream(): ...

      op = app.openapi()['paths']['/stream']['post']

      return {mt: b.get('schema', {}) for mt, b in op['responses']['200']['content'].items()}

  only_responses = media(responses=SSE)

  print('responses= only            ->', sorted(only_responses))

  assert 'application/json' in only_responses, 'expected the phantom'

  assert only_responses['application/json'] == {}, 'and it must be EMPTY'

  with_class = media(responses=SSE, response_class=StreamingResponse)

  print('responses= + response_class ->', sorted(with_class))

  assert 'application/json' not in with_class, 'response_class must remove it'

  print('CONFIRMED: responses= alone leaves an empty application/json; response_class
  removes it')

  "
provenance:
  - sources/gimme-the-lint-issue-21
sources:
  - python/gtl_contract/openapi.py
  - python/tests/test_the_advice_runs.py
tags:
  - fastapi
  - openapi
  - codegen
  - streaming
invalidated_by:
  - FastAPI no longer adding a default application/json response for routes that
    declare an explicit responses= media type
last_validated: 2026-09-01
---

# FastAPI emits a phantom EMPTY `application/json` beside a described non-JSON response

## Claim

Declaring an explicit media type via `responses={...}` does **not** stop FastAPI from also
advertising `application/json` — with an **empty** schema.

```python
@router.post("/stream", responses=SSE_STREAM)
# content: {'application/json': {},  'text/event-stream': {...}}
```

Only setting `response_class=` removes it:

```python
@router.post("/stream", responses=SSE_STREAM, response_class=StreamingResponse)
# content: {'text/event-stream': {...}}
```

## Why it matters

A code generator picking `application/json` — the conventional default — gets an empty
schema and types the endpoint `any`. That is the precise failure
[`openapi/route-without-response-model`](../../standards/contract-rules-guide.md) exists to
prevent, so a route in this state is broken in exactly the documented way **while looking
correct**: the developer described their response honestly and reasonably believed they
were done.

## How it was found

Reported in #21 by a team who took a codebase from **48 to 0**
`route-without-response-model` findings. Six of the 48 were streaming endpoints. They only
noticed because they inspected the emitted document rather than trusting the rule's
verdict — the rule passed all six.

Through 2.8.2 the check asked *"does some media type have a schema?"* and returned on the
first one it found. Since 2.9.0 it asks *"is anything a client might pick left empty?"*

## The fix, both halves

```python
@router.post(
    "/stream",
    responses={200: {"content": {"text/event-stream": {"schema": Chunk.model_json_schema()}}}},
    response_class=StreamingResponse,
)
```

`responses=` describes the shape. `response_class=` stops FastAPI claiming a JSON body it
never sends. **Neither half works alone.**

> ⚠️ Do **not** reach for `response_model=` on a non-JSON route. FastAPI serializes
> *through* it, so it is meaningless at best — and it leaves the empty `application/json`
> exactly where it was.

## See also

- [FastAPI omits the response schema without `response_model`](fastapi-omits-response-schema-without-response-model.md)
- [Contract Rules](../../standards/contract-rules-guide.md) — `openapi/route-without-response-model`
