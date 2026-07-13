---
title: '`metadata` is a reserved attribute on every SQLAlchemy declarative model'
tier: fact
domains:
  - database
  - api
status: active
last_updated: 2026-07-13T00:00:00.000Z
id: metadata-is-reserved-on-sqlalchemy-models
confidence: high
last_verified: 2026-07-13T00:00:00.000Z
verify_command: |
  #!/usr/bin/env bash
  set -euo pipefail
  python -c "
  from sqlalchemy import Column, String
  from sqlalchemy.orm import DeclarativeBase
  class Base(DeclarativeBase): pass
  class Thing(Base):
      __tablename__='t'; id = Column(String, primary_key=True)
  print('hasattr(Thing, \"metadata\") ->', hasattr(Thing, 'metadata'))
  print('type ->', type(Thing.metadata).__name__)
  assert type(Thing.metadata).__name__ == 'MetaData'
  print('CONFIRMED: it is the MetaData registry, not a column')
  "
provenance:
  - incidents/2026-05-01-conversation-metadata-500/
sources:
  - python/gtl_contract/rules.py
  - python/gtl_contract/providers/sqlalchemy_pydantic/checks.py
tags:
  - sqlalchemy
  - pydantic
  - reserved-names
invalidated_by:
  - SQLAlchemy renaming or removing the `metadata` attribute on DeclarativeBase
word_count: 233
estimated_read_time: 2 minutes
last_validated: 2026-07-13
---

# `metadata` is a reserved attribute on every SQLAlchemy declarative model

## Claim

On any SQLAlchemy declarative model, `Model.metadata` **is the `MetaData` registry** — the
object holding every table definition for that Base. It is not, and cannot be, a column.
`hasattr(Model, "metadata")` is therefore **always `True`**, on every model, whether or not
anyone declared such a field.

## How to verify

Define a model with no `metadata` column at all and ask for the attribute anyway. It
resolves — to a `MetaData` instance. The `verify_command` above does this in five lines.

## Consequences

This is not a curiosity. It is a **guaranteed 500**, and it is the reason
`contract/reserved-metadata-unaliased` exists.

A Pydantic response schema with `from_attributes=True` and a field named `metadata` will
read `Model.metadata` — the registry — instead of a column. Pydantic then fails with
`Input should be a valid dictionary [input_value=MetaData()]`, and **every GET and every
PUT on that entity returns a 500, forever**.

Worse: the ORM's `hasattr` returning `True` is exactly what makes the bug *invisible* to
casual inspection. Nothing looks missing. The attribute is right there.

Two things follow:

1. **The column can never be named `metadata`.** Store it as `meta_config` (or anything
   else) and expose it on the wire via `Field(validation_alias='meta_config')`.
2. **A response field named `metadata` with no `validation_alias` is always a defect** —
   never baselineable, because it is not a gap in coverage, it is an endpoint that is
   already broken.

## See also

- [Contract Rules](../../standards/contract-rules-guide.md) — `contract/reserved-metadata-unaliased`
- [Decision vs Debt](../../standards/decision-vs-debt-guide.md) — why this can never be grandfathered
