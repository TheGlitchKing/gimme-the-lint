---
title: Contract Troubleshooting
tier: guide
domains:
  - troubleshooting
status: active
last_updated: 2026-07-13T00:00:00.000Z
version: 2.7.0
word_count: 572
estimated_read_time: 3 minutes
last_validated: 2026-07-13
---

# Contract Troubleshooting

The entity-contract check **imports your application**. That is the source of most of
its failure modes, and all of them are recoverable.

**The rule that governs this whole page:** a skip means **UNCHECKED**, not **CLEAN**.
Every failure below results in a loud `⚠ SKIPPED` and a push that proceeds — but the
contract was **not** verified. If you see one, the guard is not running.

---

## `contract: skipped — gtl-contract not installed`

The checker is not in your venv.

```bash
gimme-the-lint install
# or, directly:
pip install -e ./node_modules/@theglitchking/gimme-the-lint/python
```

Benign, and expected before setup. But if you *wanted* the check, it is not running.

---

## `contract: skipped — could not import the application's models`

The commonest failure, and the traceback names the cause. Usually one of:

### A missing environment variable

Your `app/config.py` reads `DATABASE_URL` at import and raises when it isn't set. Tests
work because pytest loads a `.env`; the checker does not.

**Fix:** make the import survive without it (settings should be lazy), or supply the
variable in the environment where hooks run.

### A model that connects at import

`engine.connect()` or `Base.metadata.create_all()` at module scope. This will also make
your app slow to start and impossible to test offline — the checker is just the first
thing to say so out loud.

**Fix:** move it behind a function.

### The venv isn't the one your app uses

The checker resolves `gtl-contract` from `.venv/bin/` next to the app, then the repo
root. If your app lives in a different venv, install it there.

---

## `contract: skipped — imported X but found no mapped models`

The package imported, but the ORM registry is **empty**.

Almost always: `contract.models` points at the wrong package. Importing a models package
is what *populates* the registry, so pointing it at an empty one yields nothing.

```js
contract: {
  models: ['app.models'],   // must be the package that DEFINES your models
}
```

**This is reported rather than passed**, on purpose. An empty inventory would otherwise
produce zero violations and read as a clean bill of health for an application with fifty
tables.

---

## `contract/unimportable-module`

A single module in your models/schemas package will not import — usually dead code.

The scan **continues**; the rest of your app is still checked. But whatever models live
in that module are **invisible**, and their contract goes unchecked.

**Fix:** repair the module, or delete it if it is dead. (The first real codebase this ran
against had a backward-compat shim re-exporting a class renamed away years earlier.
Nothing imported it, so it had rotted in silence.)

---

## The check is too slow

It imports your whole app — typically 1-3 seconds.

It runs on **push**, not on commit, precisely for this reason. If it is running on every
commit, your hooks are stale:

```bash
gimme-the-lint hooks
```

If a *push* is taking minutes rather than seconds, your application is slow to import,
and that is worth knowing independently: it is also making your test suite and your
container startup slow.

---

## I disagree with a rule

Read its incident first:

```bash
gtl-contract rules | jq '.rules[] | select(.id == "contract/column-not-writable")'
```

Every rule carries the production bug it stands on. They are not stylistic.

If it is still wrong **for your entity**, that is what the config is for — and the reason
you write is the point, not a tax:

```js
contract: {
  entities: {
    Deal: {
      intentionallyAbsent: {
        operating_expenses:
          'Set by the nightly underwriting job. A client that could forge it could ' +
          'forge the deal economics.',
      },
    },
  },
}
```

---

## `baseline` won't silence it

Then it is a **defect** — the code is broken now, not merely imperfect. `baseline` will
not capture it, by design, and it tells you so.

Fix it, or except it with a reason. See
[`decision-vs-debt-guide.md`](../standards/decision-vs-debt-guide.md).

---

## 🚨 Everything suddenly looks new

**Stop. Do not run `baseline`.**

This is a bug in the tool, not in your code. Re-baselining would grandfather your entire
backlog in one irreversible command and destroy the evidence.

Report it. See [`upgrade-guide.md`](../procedures/upgrade-guide.md).

---

## Turning it off

Per-app, in `.gtl/config.js`:

```js
apps: {
  'backend': { linters: ['ruff'] },   // contract omitted
}
```

Honest and explicit. Preferable to `--no-verify`, which turns off *everything* and
becomes a habit.
