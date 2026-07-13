---
description: Check whether your data model agrees with the schemas that expose it (entity-contract drift)
---

Run the entity-contract check and report the findings.

```bash
gimme-the-lint check --all --stage=push
```

## What this asks

Not *"is this code well-formed?"* but **"does your persistence model agree with the
transport schemas that expose it?"**

The bugs it catches are all silent — nothing is malformed, nothing crashes, and the API
returns success:

- a column no write schema accepts → the client's value is dropped, and the API says 201
- an update schema with a non-`None` default → clicking Save overwrites the user's data,
  and returns 200
- a response field named `metadata` → reads SQLAlchemy's MetaData registry, 500s forever

## Reporting the results

**Contract violations have no autofix.** Do not offer to run `check --fix` — there is
nothing for it to fix.

**Do not offer to run `gimme-the-lint baseline` to make them go away.** For debt-class
violations it works, and it would grandfather a real bug without the user ever seeing it.

Instead:

1. **Show the violations.** Each message names the model, the column, and the consequence.
2. **Separate defects from debt.** A violation the output marks as un-baselineable means
   the code is broken *right now* (a read that 500s, a write that destroys data). Lead
   with those.
3. **Offer the honest options:** fix it, or — if genuinely deliberate — declare it in
   `.gtl/config.js` with a reason. The reason is mandatory, and that is the point.

## If it skips

`⚠ SKIPPED` means **UNCHECKED**, not clean. The checker imports the app; a missing venv,
an absent env var, or a model that connects at import will stop it. The reason and the
traceback are printed. Fix the cause — do not report a skip as a pass.

## Related

- `gimme-the-lint materialize` — write down the API contract (openapi.json)
- `gimme-the-lint verify` — the checks needing a database (CI only)
- `gtl-contract rules` — every rule, and the production bug it stands on
