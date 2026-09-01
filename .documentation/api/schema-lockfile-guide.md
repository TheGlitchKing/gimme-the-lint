---
title: The API Contract Lockfile
tier: guide
domains:
  - api
status: active
last_updated: 2026-07-13T00:00:00.000Z
version: 2.7.0
word_count: 606
estimated_read_time: 4 minutes
last_validated: 2026-07-13
---

# The API Contract Lockfile

## The gap

FastAPI computes an OpenAPI document from your Pydantic schemas and serves it at
`/openapi.json`. It is complete, it is correct — and it is **invisible to every tool
that reads files**.

So nothing stops a field rename from silently breaking every client of that endpoint.
There is no artifact to diff, so there is no diff, so there is no warning. You find out
when the frontend breaks.

```bash
gimme-the-lint materialize
```

writes it down. A breaking API change becomes a reviewable line in a pull request
instead of a 4am page.

---

## Schema-first vs. code-first

The most important distinction in this guide, because getting it wrong destroys either
a guarantee or somebody's work.

### Schema-first — the file is the source of truth

You hand-wrote an `openapi.yaml` (or a `.proto`, or a `.graphql`). The server stubs and
the client SDKs are **generated from it**.

- The file is **input**. It is yours.
- `spectral` / `buf` lint it. `buf breaking` diffs it against git.
- **`materialize` will never touch it.**

### Code-first — the code is the source of truth

You wrote Pydantic schemas; FastAPI derives the document. There is no file.

- `materialize` **derives** it and writes it down as a **lockfile**.
- The lockfile is *compiled output*, not a document you maintain.

### Both — the most valuable check here

An authored spec **and** an app that derives a different one? That disagreement is
`contract/spec-implementation-mismatch`, and it is the best finding in the product: a
published contract that has quietly stopped describing the implementation, while
clients are still being generated from it.

**Neither file is overwritten.** You decide which side is wrong.

---

## The file-class rule

Three kinds of file, three different rules. Conflating them produces a guard that
reports success while guarding nothing.

| class | example | rule | why |
|---|---|---|---|
| **config** — *yours* | `.spectral.yaml`, `.gtl/config.js` | **create-if-absent**, never clobbered | the plugin seeds a default once; the file belongs to you |
| **baseline** — *generated* | `.gtl/apps/*/baseline.json` | written by `baseline` **only**, never by `check` | a `check` that could write a baseline would grandfather the very violation it exists to block |
| **lockfile** — *compiled* | `openapi.json` | **always regenerated** | its whole job is to state what the code says **now** |

A create-if-absent lockfile would be seeded at install time and respected forever. It
goes stale the instant anyone edits a schema — and then `check` is diffing today's API
against a snapshot from whenever someone first ran `install`.

**A silently stale lockfile is worse than no lockfile: it is a guard that reports
green.** It behaves like `package-lock.json`, not like `.eslintrc`.

---

## Provenance: we never overwrite what we did not write

The document we emit carries a marker:

```json
{ "x-generated-by": "gimme-the-lint", "openapi": "3.1.0", ... }
```

**A file without that marker is authored, and authored is sacred.** `materialize`
refuses it, byte for byte, and says so.

The mode is never *inferred*, because both mistakes are reachable from the same wrong
assumption in opposite directions: guess "code-first" on a hand-written spec and you
destroy human work on a routine command; guess "schema-first" on a derived one and the
guard goes stale and inert.

---

## Who writes the lockfile

**`materialize`, and nothing else.**

- `check` **never** writes it. It materializes to a temp dir and compares. A hook that
  edits your working tree behind your back is a hostile hook.
- `baseline` has no business touching source.

One writer, one code path — so *"what could have written this?"* always has exactly one
answer.

---

## Workflow

```bash
gimme-the-lint materialize     # derive it
git add openapi.json           # commit it — this is the point
git commit -m "chore: materialize the API contract"
```

From then on, `check` compares **twice**:

1. **regenerated-from-code** vs. **the committed lockfile** → disagreement is
   `contract/lockfile-stale`. *You changed a schema without regenerating.*
2. **the committed lockfile** vs. **its own history** → the actual breaking-change diff.

That first comparison is what makes the whole thing trustworthy. Without it, a developer
renames a field, never regenerates, and the lockfile keeps asserting the old shape
forever — so the breaking-change check compares two identical stale files and reports no
breakage. The guard goes inert and still shows green.

### ⚠ Committing the lockfile puts every `example` into a scanned file

**Expect your first adoption PR to fail secret scanning.** This is the tool working, but
it is a bad surprise if nobody warned you (#23).

Every `example` value in your Pydantic schemas ships **verbatim** in the emitted document:

```python
reset_token: str = Field(..., json_schema_extra={"example": "eyJhbGciOiJIUzI1NiI..."})
```

```json
"reset_token": { "type": "string", "example": "eyJhbGciOiJIUzI1NiI..." }
```

That fake JWT lived harmlessly in your source for years. Committing the lockfile moves it
from *a string in a Python file* into **a committed artifact a secret scanner walks** —
and a scanner cannot tell a fake JWT from a real one. Anything credential-shaped —
JWTs, API-key patterns, bearer tokens, connection strings — will be flagged.

On the reporting codebase this failed the adoption PR on `generic-api-key`, twice, on the
same fake reset token.

**Fix them at the source:**

```python
reset_token: str = Field(..., json_schema_extra={"example": "<the reset token from the email link>"})
```

Scanner-clean, and a better example than a truncated base64 blob — nobody learned anything
from the JWT.

> 🔴 **Do NOT allowlist `openapi.json` in your gitleaks config.** It is the single file
> that mirrors your entire API surface. Allowlisting it to clear one fake JWT permanently
> blinds the scanner to every real credential that ever lands in a schema default, an
> example, or a description — and it will look green while doing it.
>
> The shipped `.gitleaks.toml` allowlists `/examples/` and `/templates/` **paths**, and
> carries stopwords like `placeholder` and `fake-key`. Reach for a narrower fix in that
> direction — a stopword, a specific regex — long before a whole-file exemption. Better
> still, fix the example.

The finding is not noise. A scanner objecting to your examples is telling you there are
credential-shaped strings in your source, and it is right to.

---

## The downstream win — now owned by the tool

**This guide used to end here with a shell command and a shrug**, telling you to run
`openapi-typescript` by hand and hoping you remembered. Nothing failed if you didn't. The
tool knew this was the payoff and did not own it.

It does now:

```bash
gimme-the-lint materialize   # writes the lockfile AND regenerates your client types
```

Configure it once, alongside the rest of the `contract` block:

```js
contract: {
  app: 'app.main:app',
  lockfile: 'openapi.json',
  codegen: [
    { generator: 'openapi-typescript', output: 'frontend/src/api-types.ts' },
  ],
}
```

Now a stale client type is `contract/codegen-stale` — a **defect**, blocked, never
baselineable. Your frontend's types are **generated** from the same document your backend
serves, and hand-mirrored types stop being a drift source: not *detected*, but
**impossible**.

See [`codegen-guide.md`](codegen-guide.md).

---

## See also

- [`contract-guide.md`](contract-guide.md) — the entity contract
- [`contract-rules-guide.md`](../standards/contract-rules-guide.md) — `lockfile-stale`, `spec-implementation-mismatch`
