---
title: Principles
tier: standard
domains:
  - standards
audience:
  - developers
tags: []
status: active
last_updated: 2026-07-18
version: 2.8.1
purpose: '**gimme-the-lint manages lint violations and data-model/schema drift,
  progressively.**'
estimated_read_time: 4 minutes
word_count: 697
last_validated: 2026-07-18
backlinks: []
---

# Principles

**gimme-the-lint manages lint violations and data-model/schema drift, progressively.**

Both halves of that sentence are load-bearing, and the adverb governs both.

## The bargain

A check that blocks on everything it finds is a check nobody turns on. So every check here
records what already exists and blocks only what is *new*. Existing findings become debt
that shrinks at the team's pace; the ratchet only ever tightens.

That bargain was built for linters. It applies unchanged to a second question:

| | asks | answered by | rules belong to |
|---|---|---|---|
| **lint** | is this code well-formed? | 17 adapters, one per tool | the tool (eslint, ruff, …) |
| **contract** | does the data model agree with the schemas that expose it? | providers, one per stack | the provider |

These are **co-equal domains of one product**, not an engine with an add-on. Contract
checking arrived in v2.6, which makes it younger, not lesser. Anything true of one half is
presumed true of the other until someone argues otherwise in writing.

## The firewall

The engine knows nothing about any language, tool, or framework. It sees opaque
violations, hashes them, diffs them against a baseline. That ignorance is what makes both
halves extensible in the same shape:

- **A linter** is `LinterAdapter` (`lib/adapters/adapter.js:59`) — one file plus one line in
  the `REGISTRY` map.
- **A stack** is `Provider` (`python/gtl_contract/providers/base.py:63`) — one binding of a
  persistence layer to a transport layer. `sqlalchemy_pydantic` ships; django+drf and
  prisma+zod are the named candidates.

Rules belong to the provider exactly as ESLint's rules belong to ESLint. When engine code
starts knowing what `org_id` means, the firewall has been breached — the fix belongs in a
provider, every time.

## Does this belong here?

Four questions, in order. A "no" is not fatal, but it must be argued.

1. **Is it progressive?** A new rule must be baselineable, unless it is a defect
   (see [Decision vs Debt](./decision-vs-debt-guide.md)). A check that cannot be
   grandfathered blocks adoption on day one, and a tool nobody adopts guards nothing.
2. **Does it stay behind the firewall?** Framework knowledge lives in adapters and
   providers. Never in the engine.
3. **Can it fail silently?** If the answer is yes, it is not ready. See below.
4. **Does it hold for both halves?** A convenience added to lint that contract cannot have
   is a fork forming.

## Never report green while not guarding

This is the failure the tool exists to eliminate, so it must not be how the tool fails.
Stated positively: **every outcome must be distinguishable from success.**

The invariants in `CLAUDE.md` are that principle applied, and
`tests/invariants.test.js` enforces each one — every test there was verified by
deliberately breaking the implementation and watching it go red. The recurring shape:

- **"We found nothing" and "we could not look" are the same number and opposite facts.**
  `ProviderResult` keeps them apart (`checked=False` + reason ≠ empty violations); the
  engine turns a skip into a loud warning, never a pass.
- **Incomplete is never clean.** A baseline section captured while the linter was missing
  does not gate.
- **A defect cannot be grandfathered** — three independent gates, so even a hand-edited
  baseline cannot smuggle one through. 10 of the 21 contract rules are defects.
- **Guidance must be true.** Telling someone to run `--fix` for a linter with no autofix
  sends them to `baseline` next, which grandfathers the thing that just blocked them.
- **Fail toward inert, never toward annoying.** `--stage` defaults to `commit` because a
  stale hook should do *less*, not more.

## A rule earns its place by the incident it stands on

Every contract rule carries the production failure it prevents. A rule whose reason has
rotted is a rule somebody deletes in a hurry, at the worst possible moment — so the reason
is documentation, not decoration.

The same standard governs exemptions in the other direction: a `decision` requires a
written reason with a minimum length, and that friction is the feature.

## See also

- [Architecture Guide](../architecture/architecture-guide.md) — how the pipeline fits together
- [Decision vs Debt](./decision-vs-debt-guide.md) — the three ways a violation may persist
- [Contract Rules](./contract-rules-guide.md) · [Lint Rules](./lint-rules-guide.md)
- [Contract Guide](../api/contract-guide.md) — the contract engine end to end
