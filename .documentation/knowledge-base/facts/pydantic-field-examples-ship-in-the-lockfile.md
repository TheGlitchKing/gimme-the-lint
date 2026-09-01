---
title: "Pydantic `Field` examples ship verbatim in the emitted OpenAPI document, so
  committing the lockfile puts them in a secret-scanned artifact"
tier: fact
domains:
  - api
status: active
last_updated: 2026-09-01T00:00:00.000Z
id: pydantic-field-examples-ship-in-the-lockfile
confidence: high
last_verified: 2026-09-01T00:00:00.000Z
verify_command: >
  #!/usr/bin/env bash

  set -euo pipefail

  python -c "

  import json

  from fastapi import FastAPI

  from pydantic import BaseModel, Field

  FAKE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N'

  class ResetRequest(BaseModel):
      reset_token: str = Field(..., json_schema_extra={'example': FAKE})

  app = FastAPI()

  @app.post('/reset', response_model=ResetRequest)

  async def reset(body: ResetRequest): ...

  blob = json.dumps(app.openapi())

  assert FAKE in blob, 'expected the example to ship verbatim in the document'

  prop = app.openapi()['components']['schemas']['ResetRequest']['properties']['reset_token']

  print('emitted ->', json.dumps(prop))

  assert prop.get('example') == FAKE

  print('CONFIRMED: a Field example ships verbatim into the committed lockfile')

  "
provenance:
  - sources/gimme-the-lint-issue-23
sources:
  - .documentation/api/schema-lockfile-guide.md
tags:
  - fastapi
  - openapi
  - pydantic
  - secrets
  - gitleaks
invalidated_by:
  - Pydantic or FastAPI ceasing to propagate json_schema_extra into the emitted document
last_validated: 2026-09-01
---

# Pydantic `Field` examples ship verbatim into the committed lockfile

## Claim

An `example` supplied via `Field(..., json_schema_extra={"example": ...})` appears
**verbatim** in the document FastAPI emits, and therefore in `openapi.json` once you
commit it.

Committing the lockfile moves those strings from *a value in a Python file* into **a
committed artifact that a secret scanner walks**.

## Why it matters

A secret scanner cannot tell a fake JWT from a real one, and it should not try. So a fake
token that sat harmlessly in a schema for years fails the build the first time the
lockfile is committed — on the adoption PR, which is the worst possible moment for a
surprise.

Reported in #23: `gitleaks` failed the PR on `generic-api-key`, twice, matching the same
fake reset token in `backend/openapi.json`.

## The fix, and the trap

Fix it at the source:

```python
# before — scanner-hostile, and nobody learns anything from it
reset_token: str = Field(..., json_schema_extra={"example": "eyJhbGciOiJIUzI1NiI..."})

# after — scanner-clean, and a better example
reset_token: str = Field(..., json_schema_extra={"example": "<the reset token from the email link>"})
```

> 🔴 **Do not allowlist `openapi.json`.** It is the one file mirroring your entire API
> surface. Exempting it to clear one fake JWT permanently blinds the scanner to every real
> credential that later lands in a schema default, example, or description — and it looks
> green while doing it. That is a guard reporting green while guarding nothing, which is
> the failure this whole tool exists to eliminate.

The finding is not noise. A scanner objecting to your examples is telling you there are
credential-shaped strings in your source, and it is right to.

## See also

- [Schema lockfile guide](../../api/schema-lockfile-guide.md) — the `materialize` workflow
- [FastAPI emits a phantom empty application/json](fastapi-emits-a-phantom-empty-application-json.md)
