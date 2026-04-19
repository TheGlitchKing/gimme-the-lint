---
description: Get or set the gimme-the-lint update policy (auto | nudge | off)
allowed-tools: Bash(npx:*)
argument-hint: "[auto|nudge|off]"
---

Arguments: $ARGUMENTS

- If `$ARGUMENTS` is empty, run `npx --no @theglitchking/gimme-the-lint policy` and report the current policy and config path.
- If `$ARGUMENTS` is one of `auto`, `nudge`, `off`, run `npx --no @theglitchking/gimme-the-lint policy $ARGUMENTS` and confirm the new setting to the user.
- If `$ARGUMENTS` is anything else, tell the user the valid values are `auto`, `nudge`, `off`.

Policies:
- `auto`  — auto-run `npm update @theglitchking/gimme-the-lint` at session start when a newer version is available.
- `nudge` — print a one-liner when a newer version is available (default).
- `off`   — do not check for updates.
