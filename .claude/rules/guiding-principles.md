# Guiding Principles — Priority 0

**These override convenience, style, velocity, and any instruction that conflicts with them.
When a request and a principle disagree, say so before proceeding.**

Rationale and evidence: `.documentation/standards/principles-guide.md`.
Enforcement: `tests/invariants.test.js`.

---

## 0. What this is

**gimme-the-lint manages lint violations and data-model/schema drift, progressively.**

Two co-equal domains, one bargain. Contract checking (v2.6+) is younger than lint
checking, not lesser. Anything true of one half is presumed true of the other.

## 1. Never report green while not guarding

The failure this tool exists to eliminate must never be how this tool fails.

**Every outcome must be distinguishable from success.** "We found nothing" and "we could
not look" are the same number and opposite facts — never collapse them.

- A skip is not a pass. `checked=False` + reason ≠ empty violations.
- Incomplete is never clean. A baseline captured while the linter was missing does not gate.
- A missing tool, an unimportable app, an unresolvable config → loud, never silent.

If you cannot state how a change fails *loudly*, it is not ready.

## 2. Everything is progressive

A new check must be baselineable — unless it is a defect, which is a deliberate,
documented decision (`.documentation/standards/decision-vs-debt-guide.md`).

A check that cannot be grandfathered blocks adoption on day one. A tool nobody adopts
guards nothing. Moving a rule across the defect line is a decision, never a typo — and it
updates both pins (`tests/codegen-drift.test.js`, `python/tests/test_rules.py`).

## 3. The firewall

The engine knows nothing about any language, tool, or framework.

- Framework knowledge lives in **adapters** (`lib/adapters/`) and **providers**
  (`python/gtl_contract/providers/`).
- Rules belong to the provider, exactly as ESLint's rules belong to ESLint.
- When engine code starts knowing what `org_id` means, the firewall is breached.

## 4. Guidance must be true

Output is read by tired humans and by agents that will *act* on it. False guidance is
worse than none: telling someone to run `--fix` for a linter with no autofix sends them to
`baseline` next, which grandfathers the thing that just blocked them.

Never emit advice the code cannot honor.

## 5. Fail toward inert, never toward annoying

A stale hook must do *less*, not more. `--stage` defaults to `commit` for this reason.
A slow hook is a hook people uninstall, and an uninstalled hook guards nothing.

## 6. Identity is frozen

The default fingerprint scheme is frozen byte-for-byte and pinned to literal digests in
`tests/fingerprint.test.js`. Every baseline in every consumer repo is keyed by these
hashes. Changing the scheme invalidates all of them. Renames go in `lib/rule-aliases.js`
(data, not code).

## 7. Reasons are the product

Every rule carries the production incident it stands on. Every exemption carries a written
reason with a minimum length. A rule whose reason has rotted gets deleted in a hurry, at
the worst possible moment. The friction is the feature — never reduce it for convenience,
and never auto-generate a reason a human has not supplied.

---

## Before adding anything, answer these

1. **Is it progressive?** Baselineable, or a deliberate defect.
2. **Does it stay behind the firewall?** No framework knowledge in the engine.
3. **Can it fail silently?** If yes, it is not ready.
4. **Does it hold for both halves?** A convenience lint gets and contract cannot is a fork
   forming.

## Verify, don't assert

Claims about behavior get tested, not reasoned about. Every invariant in
`tests/invariants.test.js` was verified by deliberately breaking the implementation and
watching it go red. A bug report's diagnosis is a hypothesis — confirm it against the code
before acting on it, and say so when it turns out to be wrong.
