# When to Use gimme-the-lint

## The Problem

Adopting linting in an existing codebase is painful. Running a linter for the first time on a mature project often produces hundreds or thousands of violations. Teams face a dilemma:

1. **Fix everything at once** — Massive, risky PR that touches every file. Merge conflicts guaranteed.
2. **Ignore the linter** — Disable rules or skip enforcement entirely. Tech debt grows.
3. **Gradually adopt** — The ideal approach, but hard to implement manually.

gimme-the-lint solves option 3 with **progressive linting**: baseline existing violations, then only enforce rules on new or changed code.

## Ideal Use Cases

### Existing Projects Adding Linting for the First Time

You have a codebase with no linting (or inconsistent linting). You want to:
- Start enforcing lint rules without fixing every existing violation
- Prevent new violations from being introduced
- Gradually reduce the violation count over time

### Monorepo Projects (Python + JavaScript/TypeScript)

You maintain a project with both a Python backend and a JS/TS frontend. gimme-the-lint handles both:
- **Frontend**: ESLint v9 with flat config, React, TypeScript, import architecture rules
- **Backend**: Ruff for Python linting with per-directory baselines
- **Shared**: Gitleaks for secrets detection, commitlint for conventional commits

### Teams Adopting Stricter Lint Rules

Your team wants to enable stricter rules (e.g., `no-explicit-any`, import boundaries) but can't fix all existing violations immediately. Progressive linting lets you:
- Enable the rule immediately
- Baseline all current violations
- Block only new violations in PRs

### CI/CD Pipelines

You want linting in your CI pipeline that:
- Only fails on new violations (not pre-existing ones)
- Posts clear PR comments showing what needs fixing
- Supports both progressive (changed files) and full (entire codebase) modes

### Projects with Directory-Based Architecture

Your project organizes code by feature directories. gimme-the-lint's directory-chunked approach:
- Auto-discovers production directories
- Creates per-directory baselines
- Detects when directories are added or removed (drift detection)

## When NOT to Use gimme-the-lint

### Greenfield Projects

If you're starting a new project from scratch, you don't need progressive linting. Just configure ESLint/Ruff directly and enforce zero violations from day one.

### Single-Language Projects with Simple Linting

If you only have a JavaScript project with basic ESLint rules already working, gimme-the-lint adds unnecessary complexity. It's most valuable for:
- Multi-language projects
- Projects transitioning to stricter rules
- Teams that need drift detection and manifest tracking

### Projects Not Using Git

gimme-the-lint relies on git for:
- Changed file detection (`git diff --cached`)
- Pre-commit and pre-push hooks
- Progressive mode (only lint changed files)

Without git, only "full" mode works, and hooks won't function.

## Decision Matrix

| Scenario | Use gimme-the-lint? | Why |
|----------|:---:|-----|
| Existing project, no linting | Yes | Baseline existing code, enforce on new code |
| Monorepo (Python + JS/TS) | Yes | Unified linting across both stacks |
| Adopting stricter rules | Yes | Baseline current violations, block new ones |
| CI with PR comments | Yes | GitHub Action with progressive mode |
| New project from scratch | No | Just use ESLint/Ruff directly |
| Single-language, simple rules | Maybe | Only if you need drift detection |
| No git | No | Core features depend on git |

## How Progressive Linting Works

1. **Baseline**: Run `gimme-the-lint baseline` to snapshot all current violations
2. **Develop**: Write new code as usual
3. **Commit**: Pre-commit hook runs linting on changed files only
4. **Compare**: Only NEW violations (not in the baseline) block the commit
5. **Drift Detection**: Manifests track directory changes, config changes, and staleness
6. **Auto-Heal**: Re-running baseline updates manifests and logs what changed

Over time, as developers naturally touch files and fix violations, the baseline shrinks to zero.
