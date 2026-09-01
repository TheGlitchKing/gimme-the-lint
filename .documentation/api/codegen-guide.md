---
title: Generated Client Types
tier: guide
domains:
  - api
status: active
last_updated: 2026-07-13T00:00:00.000Z
version: 2.7.0
word_count: 908
estimated_read_time: 5 minutes
last_validated: 2026-07-13
---

# Generated Client Types — the last unguarded rung

## The ladder

```
   Postgres columns
        ⇕   alembic-check                       guarded
   SQLAlchemy models
        ⇕   17 contract rules                   guarded
   Pydantic schemas
        ↓   materialize → openapi.json          guarded
   openapi.json
        ↓   openapi-typescript → api-types.ts   ← THIS
   frontend types
```

**Drift lives wherever two artifacts must _agree_. It cannot exist where one is
_derived_.**

Every rung above needed a human to resolve it — *is this absent column a bug, or a
decision?* — which is why they need `serverManaged` and `intentionallyAbsent` and a
mandatory reason. They were the hard part, and they are done.

**This rung needs no declarations at all.** It is pure derivation. Once the check exists,
a whole class of bug stops being *tested for* and becomes *impossible to express*.

---

## What it catches, from the wild

### The blank field

A component read `prospect.zip`. The API returns `zip_code`.

The backend was correct. The contract check was green. The lockfile was fresh. The
database row was right. And the user saw a **blank ZIP field for a full release cycle** —
because `undefined` renders as nothing, and nothing looks exactly like *"the data was
never saved."*

With generated types, that is a compile error: `Property 'zip' does not exist on type
'Prospect'`.

### The field that never existed

A hand-written `TaskFormData` declared:

```ts
estimated_hours?: number;   // NO SUCH COLUMN. The real one is `estimated_cost`.
dependencies?: string[];    // NO SUCH COLUMN.
```

…while **omitting** `notes`, `deal_id`, `estimated_cost` and `is_recurring` — all of which
are real. Wrong in both directions at once.

`estimated_hours` is the detail worth sitting with. It is not a typo. It is a *plausible*
field, one word away from a real one, that somebody invented and the compiler cheerfully
accepted forever. A user typing an estimate into that form watched it vanish.

### And every check was green

Run the entity-contract check against `Task`: **zero violations.** The SQLAlchemy model
and the Pydantic schemas agree perfectly. They always did.

**The lie was entirely in the hand-written mirror.** Every guard in this tool passed it,
because the lie was not in Python.

Both bugs were found by a human clicking around in a browser. That is not a repeatable
strategy.

---

## Setup

```js
// .gtl/config.js
contract: {
  app: 'app.main:app',
  lockfile: 'openapi.json',
  codegen: [
    { generator: 'openapi-typescript', output: 'frontend/src/api-types.ts' },
  ],
}
```

```bash
npm install --save-dev openapi-typescript
gimme-the-lint materialize     # lockfile, then types — in that order
git add openapi.json frontend/src/api-types.ts
```

`codegen` is an **array**: a monorepo may have several frontends.

**Opt-in, twice over.** It binds only when you name a generator *and* an output path. A
lockfile alone is not consent; a JS app alone is not consent. A repo that types its
frontend by hand has usually chosen that, and a linter that nags people about deliberate
choices is a linter they uninstall.

---

## The rules

| rule | class | means |
|---|---|---|
| `contract/codegen-stale` | **defect** | The committed types disagree with the lockfile. **Never baselineable.** |
| `contract/codegen-missing` | debt | A generator is configured but the output has never been written. Baselineable. |

### Why `codegen-stale` is a defect

A stale generated type is not a **gap**. It is **a lie the compiler is currently
believing**.

Grandfathering it would mean writing down: *"we accept that our frontend is typed against
an API we do not serve."* Nobody would say that out loud, so the tool will not say it for
them. Same reasoning as `lockfile-stale`, and same reasoning as an update schema that
returns a cheerful 200 while overwriting your data.

`codegen-missing` **is** debt, and must be: every repo starts without generated types, and
a check you must repair your repo to install is a check nobody installs.

---

## How it fits the chain

`codegen-drift` generates from the **committed lockfile** — never by re-deriving from the
app. That single choice makes the whole chain behave, with no adapter needing to know
about any other:

| state | what happens | why it is right |
|---|---|---|
| lockfile stale, types match it | codegen is **green** | The types faithfully describe the lockfile. The **lockfile** is what is wrong, and `lockfile-stale` says so. |
| you run `materialize` | lockfile refreshed → **types now stale** | One root cause surfaces at a time. |

**Sequential, never simultaneous. One root cause, one finding** — because reporting two
violations for one cause trains people to ignore both.

`materialize` runs the adapters in **derivation order**: the lockfile is written first,
and only then is anything generated from it. (Alphabetically, `codegen-drift` sorts
*before* `openapi` — run it that way and you would generate the types from yesterday's
lockfile, then overwrite the lockfile, and report success.)

---

## Provenance: your hand-written file is safe

The generator signs its own output:

```ts
/**
 * This file was auto-generated by openapi-typescript.
 * Do not make direct changes to the file.
 */
```

**No banner ⇒ hand-authored ⇒ sacred.** `materialize` refuses it, byte for byte, and says
so. `check` still reports where it disagrees with your API — but it will not touch it
until you delete it yourself.

This is not politeness. **Every codebase that needs this check is, by definition, one that
hand-maintains its types today.** A `materialize` that silently ate `forms.ts` would be
the last thing anyone ever ran.

---

## Determinism

A generator bump that reorders a union must not fail your CI on an unrelated Tuesday. The
first thing any team does then is disable the check — and a disabled check guards nothing.

So the **generator's** version feeds `tool_version` in the baseline, and a bump surfaces
as **drift** — *"your baseline is stale, re-baseline"* — rather than as a **violation**
that blocks a push over something nobody did. That is the distinction the engine was built
to make; this reuses it.

Line-ending and trailing-whitespace noise is normalized away, for the same reason: a
Windows checkout must not read as a contract change.

---

## Spec quality — or the guard is green over nothing

A lockfile can be perfectly fresh and completely worthless.

- **`openapi/route-without-response-model`** — FastAPI cannot infer a response schema from
  a function that does not declare one, so it emits an **empty** one. A generator then
  types the whole endpoint `any`, and your client compiles against a shape **nobody has
  ever checked**. On the first real codebase: **48 of 243 routes**.
  For a non-JSON route (SSE, file download) the fix is `responses={...}` **plus**
  `response_class=` — `responses=` alone leaves a phantom empty `application/json` that a
  generator will pick. See
  [the fact](../knowledge-base/facts/fastapi-emits-a-phantom-empty-application-json.md).
- **`openapi/unstable-operation-id`** — generators turn `operationId` into the client
  *method name*, and FastAPI derives `operationId` from the **function name**. Rename a
  handler — a pure refactor, touching no API — and every generated client method silently
  changes name. **243 of 243 routes.** One line at app construction fixes it repo-wide:
  ```python
  FastAPI(generate_unique_id_function=lambda r: f"{sorted(r.methods)[0].lower()}_{r.path}")
  ```
  Method plus path is what makes an operation unique in the document to begin with, so it
  cannot collide, and it is the only form actually decoupled from Python identifiers.
  **Not** `lambda route: route.name` — that is the function name, so it silences the rule
  without decoupling anything, and it collides on router factories. See
  [the fact](../knowledge-base/facts/route-name-generator-collides-on-router-factories.md).
- **`openapi/duplicate-operation-id`** — two operations claiming the same `operationId`,
  which makes the document **invalid**: a generator collides or silently drops all but
  one, so a client compiles fine against an endpoint it can no longer call. Added in
  2.9.0, because our own recommended fix above used to cause it.

Both are **debt** (48 findings on day one — if they blocked, you would uninstall). But
until they are fixed, `codegen-drift` is guarding a fifth of your API with the word `any`.

**A perfect lockfile over an incomplete spec is a perfect record of a lie.**

---

## For LLMs and coding agents

`codegen-stale` has **no autofix**, and `baseline` will not clear it (it is a defect).

- ❌ Do **not** run `check --fix`.
- ❌ Do **not** run `gimme-the-lint baseline`.
- ✅ Run `gimme-the-lint materialize`, and commit the regenerated types.

If the file is **hand-written**, `materialize` will refuse it — and that refusal is
correct. Tell the human; do not delete their file to make the check pass.

---

## See also

- [`schema-lockfile-guide.md`](schema-lockfile-guide.md) — the lockfile this generates from
- [`contract-guide.md`](contract-guide.md) — the rungs below
- [`decision-vs-debt-guide.md`](../standards/decision-vs-debt-guide.md) — why a defect cannot be baselined
