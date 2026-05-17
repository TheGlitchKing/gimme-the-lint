# When to Use gimme-the-lint

## The problem it solves

Adding a linter to an established codebase surfaces hundreds or thousands of
pre-existing violations. Turning linting on would block every commit until all
of it is fixed — so teams never turn it on. gimme-the-lint **baselines** the
existing violations and blocks only **new** ones, so a team can adopt linting
today and clean up the backlog at its own pace.

## Use it when

- **An existing codebase has no linting** and a clean-everything-first sweep is
  not realistic.
- **You have a polyglot monorepo** — JS/TS, Python, Go, Rust, Terraform apps
  side by side. Each app is auto-bound to its linter; one tool covers them all.
- **You want best-practice rules without hand-writing configs.** `install`
  seeds each app with a curated, security-aware config for its linter — see the
  Lint Rules Guide.
- **You use Biome, not ESLint** — drop a `biome.json` and the app uses Biome.
  No running both linters.
- **CI keeps going red on old debt.** gimme-the-lint fails CI only on new
  violations introduced by the change under review.
- **You want linting to survive ecosystem churn.** The linter is config, not a
  hardcode — swapping ESLint for Biome (or adding a new tool) is an adapter,
  not a rewrite.

## Use greenfield mode when

For a **brand-new repo** there is no debt to grandfather. Run
`gimme-the-lint init --no-baseline` (or `baseline --empty`): baselines start
empty and every violation counts as new — "strict from day one" — without
accumulating baseline files you would later regret.

## Use offline mode when

For **air-gapped or regulated environments** (FAA, GovCloud) where dev
workstations have no internet egress, `install --offline` writes configs and
hooks without any npm/pip fetch and assumes the linter toolchain is provisioned
by your image. It fails loudly if a linter is missing for code that is present.

## When you might NOT need it

- A small project you can lint clean in an afternoon — just run the linter
  normally with zero tolerance.
- A repo that already enforces zero lint violations — gimme-the-lint adds
  little there (though greenfield mode keeps it that way cheaply).

## How it fits your workflow

- **Local** — the pre-commit hook checks staged files; pre-push checks everything.
- **CI** — the GitHub Action runs the same engine and comments on the PR.
- **Claude Code** — `/lint`, `/lint:status`, `/lint:baseline`, and the
  linting agent.
