# Upgrade Guide — v2.5.x → v2.6.0

**Read this before you upgrade.** The release is additive — nothing breaks — but it
is not *inert*: one action is mandatory, and several new failure modes become
possible. Everything you need is in this one page, deliberately: when a push is
blocked and you paste the error into a chat window, a link is a dead end.

---

## The one thing you must actually do

```bash
gimme-the-lint hooks
```

Git hooks are **installed files**. `npm update` rewrites `lib/`; it cannot rewrite a
hook you installed months ago. Those old hooks call `check` with no `--stage` flag, so
the new checks **silently never fire** — you get a green hook and believe you are
guarded, and you are not.

`gimme-the-lint status` and `gimme-the-lint dashboard` both warn when your hooks
predate the engine. Re-running `hooks` fixes it.

**Why the new checks don't just run anyway:** `--stage` defaults to `commit`, and that
default is a safety property, not a preference. Had it defaulted to "run everything", a
stale hook would have started importing your whole application on **every commit** — a
multi-second pre-commit hook arriving as an upgrade surprise. A slow hook is a hook
people disable, and a disabled hook guards nothing. So a stale hook degrades to *"the
new check hasn't started yet"* (loud, detectable, one command to fix) rather than
*"your commits got slow"* (silent, infuriating, and fixed by uninstalling).

---

## What will not happen

- **Your baselines are safe.** A violation with no `fingerprintKey` hashes exactly as
  it did in v2.5.2 — byte for byte, asserted against digests pasted in as literals. A
  project baselined by v2.5.2 upgrades, reports zero new violations, and leaves its
  `baseline.json` untouched.
- **A repo with no Python is unaffected.** No contract check, no OpenAPI check, nothing
  new runs.
- **A repo that never installs `gtl-contract` is unaffected.** The check warn-skips.
- **The baseline format did not change.** A contract check is a new *section* in the
  per-linter map that has existed since v2.0.

---

## The error catalog

Every error 2.6.0 can newly produce, what it means, and what to do.

### `hooks are from an older version`

**Means:** you upgraded but didn't reinstall hooks.
**Do:** `gimme-the-lint hooks`.
**Don't:** assume the feature is broken.

---

### Push blocked by `contract/*`, and it says **"cannot be baselined"**

**Means:** a **defect** — the code is broken *right now*, for everyone. Not "not yet
ideal": a read that always 500s, or a write that silently overwrites stored data.

**Do:** fix it. Or, if it is genuinely deliberate, declare it in `.gtl/config.js`
**with a reason**.

**Don't:** run `gimme-the-lint baseline` expecting it to help. It will not, **by
design** — and it will tell you so.

> Why: grandfathering one of these means writing down *"we accept that every read of
> this entity returns a 500."* Nobody would say that out loud, so the tool will not say
> it for them. The escape hatch exists — it just costs you a sentence. **The friction
> is the feature.**

---

### Push blocked by `contract/*`, and it is baselineable

**Means:** **debt** — a gap, not a break. The app works; it has a hole in it.

**Do:** fix it, or `gimme-the-lint baseline` to grandfather it. That is exactly what
progressive linting is for.

**Don't:** `--no-verify`.

---

### `baseline` says *"N violations were NOT baselined"*

**Means:** working as designed. Those N are defects (see above).

**Do:** fix or except those N.
**Don't:** re-run `baseline` expecting a different answer.

---

### `contract: skipped — gtl-contract not installed`

**Means:** benign. The check is inert.
**Do:** `gimme-the-lint install` (or `pip install -e ./node_modules/@theglitchking/gimme-the-lint/python` into your venv).
**Don't:** ignore it if you *wanted* the check.

---

### `contract: skipped — could not import the application's models`

**Means:** the checker could not import your app. Usually a missing env var, a venv
that isn't there, or a model module that opens a database connection at import time.

**Do:** read the traceback it prints — it names the cause.

**Don't:** treat it as "no violations." **A skip means UNCHECKED, not CLEAN.** Those
are the same number of findings and opposite facts.

---

### `contract/unimportable-module`

**Means:** a module in your models/schemas package cannot be imported. It is usually
dead code that has been quietly rotting — and any models inside it are **invisible** to
the contract check.

**Do:** fix the module, or delete it if it is dead.

---

### `contract/lockfile-stale`

**Means:** you changed a schema without regenerating the API contract, so the lockfile
is asserting an API you no longer serve.

**Do:** `gimme-the-lint materialize`, and commit the result.
**Don't:** hand-edit `openapi.json`.

---

### `contract/spec-implementation-mismatch`

**Means:** you have a **hand-authored** API spec, and the code no longer matches it.
Your published contract and your implementation have drifted apart.

**Do:** fix whichever one is wrong. Neither file has been touched — a spec you wrote is
yours, and `materialize` will never overwrite it.

---

### Your push got slower

**Means:** expected. The entity-contract check imports your application (seconds), so
it runs on **push**, not on every commit.

**Do:** nothing.
**Don't:** move it to pre-commit. That is the arrangement this design exists to avoid.

---

### 🚨 Every violation suddenly looks new

**Means: this is a BUG, and it is not your fault.**

**Do: STOP. Report it.**

**DON'T: run `gimme-the-lint baseline`.**

> This is the most important line in this guide. A fingerprint regression would make
> every baselined violation in every repo read as new. The instinctive response — run
> `baseline` to make the noise stop — **permanently destroys your baseline** and
> grandfathers your entire backlog in one command. It is exactly what a hurried human,
> or an LLM, will reflexively do.
>
> There is a test whose only job is to prevent this (`tests/invariants.test.js`,
> asserting against literal v2.5.2 digests). If you are seeing this anyway, that test
> has been defeated and we need to know.

---

## For LLMs and coding agents

The pre-commit hook has always told agents: *"AUTOMATICALLY run `--fix` without
asking."* **That guidance is wrong for contract rules and must not be followed.**

Contract rules are `supportsFix: false` — **there is no autofix**. An agent that
reaches for `--fix`, sees nothing change, and then reaches for `baseline` will
*succeed* at silencing a real data-loss bug and report the task complete.

So, for any `contract/*` or `migration/*` failure:

- ❌ **Do NOT run `check --fix`.** There is no autofix. It will do nothing.
- ❌ **Do NOT run `gimme-the-lint baseline`.** For a debt-class violation it *works* —
  and grandfathers a real bug with no human in the loop.
- ✅ **Surface the finding to the human.** These are correctness findings, not style.

`check` now prints exactly this guidance when the failing linter has no autofix. Follow
what the output says, not what you remember the hook saying.

---

## See also

- [`contract-guide.md`](contract-guide.md) — what the entity contract is
- [`contract-rules-guide.md`](contract-rules-guide.md) — every rule, and the bug it stands on
- [`decision-vs-debt-guide.md`](decision-vs-debt-guide.md) — defect vs. debt, and the adoption cliff
- [`contract-troubleshooting-guide.md`](contract-troubleshooting-guide.md) — when it won't run
