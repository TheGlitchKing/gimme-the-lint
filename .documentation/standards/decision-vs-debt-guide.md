---
title: Decision vs Debt (and Defects)
tier: standard
domains:
  - standards
status: active
last_updated: 2026-07-13T00:00:00.000Z
version: 2.7.0
word_count: 542
estimated_read_time: 3 minutes
last_validated: 2026-07-13
---

# Decision vs. Debt (and Defects)

There are three ways a violation can be allowed to persist, and conflating them loses
the only thing worth knowing.

| | where it lives | means | reason required? |
|---|---|---|---|
| **debt** | `.gtl/apps/<app>/baseline.json` — *generated* | "nobody has looked at this yet" | no |
| **decision** | `.gtl/config.js` — *authored* | "we looked, and it is deliberate" | **yes** |
| **defect** | *nowhere* | broken right now | cannot be baselined at all |

## Debt: the baseline

Auto-captured, reasonless, blocks anything **new**, and shrinks over time. This is what
progressive linting *is*, and it is what makes the tool adoptable on a codebase that
already has hundreds of violations.

```bash
gimme-the-lint baseline
```

Perfectly honest, and cheap. "Nobody has audited this yet" is a true and useful thing to
record.

## Decision: the config

Hand-written, and the **reason is mandatory** (minimum 15 characters — `n/a`, `TODO` and
`legacy` are not reasons).

```js
module.exports = {
  contract: {
    entities: {
      BudgetLineItem: {
        serverManaged: ['line_item_id'],
        intentionallyAbsent: {
          project_id:
            'immutable: a line item cannot be moved between projects. Required on ' +
            'the standalone create; supplied by the parent when nested.',
        },
      },
    },
  },
};
```

**Why the reason is enforced:** an unexplained omission is indistinguishable from the
bug it is hiding. The reason is how tacit knowledge — *"why can't you change an event's
type?"* — gets written down instead of living in one person's head until they leave.

A flat baseline would flatten both of these into "grandfathered", and lose the
difference between *we thought about this* and *nobody has looked*.

## Defects: neither

Some violations mean the code is **broken right now**, for everyone, regardless of what
anyone does next. Those may never be silently grandfathered.

### The predicate is not "returns a 500"

`contract/update-has-create-default` returns a cheerful **200** while overwriting the
user's stored data on every save. That is **worse** than a 500 — because a 500 is loud.

The actual test:

> **Is the app broken right now — or certain to break — for everyone, regardless of what
> anyone does next?**

If yes, it is a defect.

### The three gates

This is the one place the tool stops being progressive, and therefore the rule people
will most want to work around. So it is enforced three times over:

1. **`baseline` will not capture it.** Not "discouraged from grandfathering" — the
   fingerprint is physically absent from the file that does the grandfathering. Running
   `baseline` deliberately, twice, with intent, will not put it there.
2. **The diff engine ignores a planted hash.** Gate 1 means a baseline *we* wrote cannot
   contain one — so the way around it is to open the JSON and paste the hash in
   yourself. Trusting the file would make the guarantee only as strong as the least
   careful edit anyone ever made to it.
3. **`baseline` tells you what it refused,** with the reason and the escape hatch.

### The escape hatch (and why it costs a sentence)

A defect **can** be excepted — in `.gtl/config.js`, with a reason.

```js
classifications: {
  ChatSession: {
    kind: 'telemetry',
    reason:
      'A coach chat session record, written by the app rather than authored by the ' +
      'user. Drift here loses a session row, not a user\'s data.',
  },
},
```

Two kinds, and the distinction is load-bearing:

- **`telemetry`** — a *decision*. Permanent, justified, will never be "fixed".
- **`triage`** — *debt with a name on it, not a shrug*. Temporary, cites where the work
  is tracked, must shrink to zero.

Nobody is going to type *"we accept that GET /conversations returns 500 for every
user."* **The friction is the feature.**

---

## ⚠ The adoption cliff

**This is the most surprising behavior in the product, and you should know about it
before you meet it.**

If you install gimme-the-lint on a repo that already has a defect — say, an unaliased
`metadata` field that has been 500ing an endpoint for a year — then:

- `baseline` will **refuse** to grandfather it, and say so.
- Your next **push** will be **blocked**.
- You **cannot** make it go away by running `baseline` again.

You have exactly two options: **fix it**, or **except it with a written reason**.

That is deliberate. But it is also the "linter finds a thousand problems on day one"
disease this entire product exists to cure — so it is worth being precise about how
narrow it is:

- It applies **only to defects**, never to debt. Debt is the overwhelming majority.
- It blocks the **push**, not the commit. You can keep working locally.
- The `baseline` output names every one of them, with the reason and the fix.

On the first real codebase this was pointed at — a mature FastAPI app with 42 models —
the answer was **zero defects**. The debt was in the hundreds. That is the shape you
should expect: the cliff is real, and it is usually a step.

### But "nothing blocks" is not the same as "adoption is cheap"

This page used to stop at the paragraph above, and that was a half-truth worth
correcting (#16).

A second adoption, 56 models and 248 routes, also had **zero defects** — so, as promised,
nothing blocked. It still opened with **429 findings** (137 contract, 292 openapi), and
essentially none of them were bugs: they were deliberately server-managed columns the
tool had no way to know were deliberate.

Zero defects means *your push is not blocked*. It does not mean the first run is quiet,
and on a repo that already has its own notion of server-managed columns it will not be.
That matters because **the natural response to a wall of findings is `baseline`** — and
baselining the wall grandfathers the handful of real findings along with the noise.

So the honest expectation is two numbers, not one:

| | what it means | what to do |
|---|---|---|
| **defects** | blocks your push | fix, or except with a written reason |
| **debt** | does not block | read it *before* you baseline it |

The second row is where the adoption cost actually lives. Budget for reading it.

After porting their existing declarations into `entities{}`, that second codebase went to
**0 violations**, and the engine agreed exactly with the hand-rolled pytest contract they
already had. The findings were real work, correctly identified — the cost was the
reading, not the fixing.

---

## See also

- [`contract-rules-guide.md`](contract-rules-guide.md) — which rules are defects, and why
- [`upgrade-guide.md`](../procedures/upgrade-guide.md) — the full error catalog
