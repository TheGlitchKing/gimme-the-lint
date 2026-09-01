---
title: Git Hooks Guide
tier: guide
domains:
  - procedures
audience:
  - all
tags: []
status: active
last_updated: 2026-08-31
version: 2.8.2
purpose: How `gimme-the-lint` installs into git, where the files actually land,
  and what to do when your repo already owns its hooks.
estimated_read_time: 1 minute
word_count: 130
last_validated: 2026-08-31
backlinks: []
---

# Git Hooks Guide

How `gimme-the-lint` installs into git, where the files actually land, and what to do
when your repo already owns its hooks.

---

## Where the hooks go

**The directory is resolved, never assumed.** `gimme-the-lint hooks` asks git:

```bash
git rev-parse --git-path hooks
```

which honors `core.hooksPath` and linked worktrees both. On a plain repo that is
`.git/hooks`. On a repo that sets `core.hooksPath = .githooks` — a common convention,
because it lets hooks be version-controlled and shared across a team — it is `.githooks`,
and git **never opens `.git/hooks`** at all.

`hooks` prints the directory it wrote to, and `status` prints the directory it read:

```
  Git repo:      yes
  Hooks dir:     .githooks
    pre-commit: installed
    pre-push: installed
```

If those two ever disagree, the tool is claiming a guard it does not have. Before
**2.8.2** they did: the directory was hardcoded to `.git/hooks`, so on any
`core.hooksPath` repo the installer wrote two files git would never execute and `status`
read the same wrong directory back and reported *installed*. See [issue #13].

## Upgrading onto 2.8.2 from a `core.hooksPath` repo

The files an older version left in `.git/hooks` are still there, and git has never run
one of them. `status` now says so:

```
⚠ pre-commit is NEVER RUN — core.hooksPath sends git to .githooks.
  Those files are left over from an older install. They guard nothing.
  Fix: gimme-the-lint hooks
```

Re-run `gimme-the-lint hooks`. The leftovers in `.git/hooks` are inert and can be deleted
by hand; nothing reads them.

## When your repo already owns its hooks

A shared `.githooks/pre-push` that also regenerates a project map, gates on testing
drift, and scans for image secrets is not ours to overwrite. `hooks` **refuses**:

```
✗ pre-push was not written by gimme-the-lint:

    /repo/.githooks

  Overwriting them would take ownership of hooks your repo already
  relies on — under core.hooksPath they are version-controlled and
  shared with your team. Compose instead:

    gimme-the-lint hooks --print pre-commit >> <your hook>
    gimme-the-lint hooks --print pre-push   >> <your hook>
```

Nothing is written when the refusal fires — a partial install half-owns the repo.

### Composing with `--print`

`hooks --print <pre-commit|pre-push>` emits a block to paste into a hook you already own:

```bash
gimme-the-lint hooks --print pre-push >> .githooks/pre-push
```

```bash
# --- gimme-the-lint (gtl-hook-contract: 2) ---
# Refresh with: gimme-the-lint hooks --print pre-push
GTL="$(git rev-parse --show-toplevel)/node_modules/.bin/gimme-the-lint"
[ -x "$GTL" ] || GTL="$(command -v gimme-the-lint || true)"
if [ -x "$GTL" ]; then
    "$GTL" check --all --stage=push || exit 1
else
    echo "gimme-the-lint: not installed, skipping"
fi
# --- end gimme-the-lint ---
```

The block carries the same `gtl-hook-contract` marker the installed hooks carry, so
`status` reports an embedded block as `installed` — and ages it to `stale` on exactly the
same terms — rather than seeing your file as somebody else's hook.

If you would rather take the file anyway: `hooks --force` overwrites and keeps a
`<hook>.backup.<timestamp>` beside it. `uninstall` restores the most recent backup.

## The two stages

| Hook | Runs | Why |
|---|---|---|
| `pre-commit` | `check --stage=commit` | The fast per-file linters. |
| `pre-push` | `check --all --stage=push` | Everything above, plus the whole-app checks — the contract engine has to import your application, which costs seconds. Seconds are fine once per push. |

`--stage` defaults to `commit`, and that default is a safety property: hooks are installed
*files*, and upgrading the package cannot rewrite a hook installed months ago. A stale
hook that passes no `--stage` must therefore do **less**, never more.

## Staleness

Every hook and snippet we emit carries `# gtl-hook-contract: N`. `status` and `dashboard`
compare that number against the engine's:

```
⚠ pre-commit hook(s) predate this version — they will NOT run the newer checks.
  Fix: gimme-the-lint hooks
```

An old hook still exits 0 and still looks installed; it just quietly runs fewer checks
than the engine now provides. Detection is by marker, not by guessing.

## Bypassing

```bash
git commit --no-verify
git push --no-verify
```

---

## See also

- [Upgrade guide](upgrade-guide.md) — the full error catalog for version moves.
- [Troubleshooting](../troubleshooting/troubleshooting-guide.md) — "Pre-commit hook does
  not run".
- [Installation guide](../quickstart/installation-guide.md)

[issue #13]: https://github.com/TheGlitchKing/gimme-the-lint/issues/13
