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

---

## See also

- [`contract-rules-guide.md`](contract-rules-guide.md) — which rules are defects, and why
- [`upgrade-guide.md`](upgrade-guide.md) — the full error catalog
