# Installation Guide

gimme-the-lint v2.0 — polyglot progressive linting.

## Requirements

- **Node.js** >= 20
- **Git** — for hooks and staged-file detection
- A linter for each language you lint:
  - JavaScript/TypeScript — `eslint` **or** `biome`
  - Python — `ruff`
  - Go — `golangci-lint`
  - Rust — `clippy` (ships with the Rust toolchain)
  - Terraform / OpenTofu — `tflint`
  - Ansible — `ansible-lint`

Any language whose linter is not installed is simply skipped (see the
troubleshooting guide) — gimme-the-lint never hard-requires a toolchain.

## Install

### npm — local (recommended)

Best for teams: everyone who clones the repo gets it.

```bash
npm install --save-dev @theglitchking/gimme-the-lint
npx gimme-the-lint install
```

### npm — global

```bash
npm install -g @theglitchking/gimme-the-lint
gimme-the-lint install
```

### Claude Code plugin

```
/plugin install TheGlitchKing/gimme-the-lint
```

## Install modes

| Mode | Command | Use when |
|------|---------|----------|
| Standard | `gimme-the-lint install` | Normal projects with internet access |
| Offline | `gimme-the-lint install --offline` | Air-gapped / regulated workstations — no npm/pip fetches; the toolchain is provisioned by your image. Fails loudly if a linter is missing for code that is present. |
| Greenfield | `gimme-the-lint init --no-baseline` | Brand-new repos — writes empty baselines and installs hooks so every violation is new ("strict from day one") |

## After installing

```bash
gimme-the-lint baseline      # capture existing violations as baselines
gimme-the-lint hooks         # install pre-commit + pre-push hooks
gimme-the-lint dashboard     # review baseline status and drift
```

Commit the generated `.gtl/` directory — it is the team-shared baseline.

## Best-practice linter configs

`install` seeds each discovered app with a best-practice ("recommended" tier)
config for its linter — **create-if-absent**, so an existing config is never
overwritten (`--force` replaces):

| Codebase | Seeded into the app dir |
|----------|-------------------------|
| JS / TS (ESLint) | `eslint.config.js` + `.prettierrc.json` |
| JS / TS (Biome) | `biome.json` |
| Python (Ruff) | `pyproject.toml` `[tool.ruff]` |
| Go | `.golangci.yml` |
| Rust | `clippy.toml` + `Cargo.toml` `[lints.clippy]` |
| Terraform | `.tflint.hcl` |
| Ansible | `.ansible-lint` |
| Secrets (all) | `.gitleaks.toml` at the repo root |

The ESLint config needs extra dev dependencies in the target project
(`eslint-plugin-security`, `eslint-plugin-no-secrets`, `eslint-config-prettier`,
`prettier`, …). See the **Lint Rules Guide** for the full list, the baseline
rules each codebase ships, and how/where to adjust them.

## Terraform / OpenTofu app discovery

Terraform has no manifest file (a directory of `*.tf` / `*.tofu` files *is* the
module), so gimme-the-lint discovers Terraform apps by source extension rather
than by a manifest like `package.json` or `go.mod`.

**Known limitation — root-module layout.** When `*.tf` files sit at the repo
root *and* in `modules/*/` beneath it, the root directory is treated as a
*workspace root* and is not linted on its own — only the leaf module
directories are. This is the same nesting rule applied to every language (a
`go.mod` at the root with `go.mod` files under it behaves identically).

- The **environment layout** — `environments/dev/`, `environments/prod/` with a
  separate `modules/` tree — is discovered cleanly with zero config.
- For a **root-module layout** (live `.tf` at the repo root plus local
  `modules/`), bind the root explicitly in `gimme-the-lint.config.js` so it is
  linted:

  ```js
  module.exports = {
    apps: {
      '.': { linters: ['tflint'] },
    },
  };
  ```

An explicit `apps` entry always overrides auto-discovery.

## Upgrading from v1

v2 changes the baseline layout, baseline format, and config schema. Run:

```bash
gimme-the-lint migrate
```

It backs the legacy `.lttf/` + `.lttf-ruff/` directories up under
`.gtl/legacy-backup/` and re-baselines into the v2 `.gtl/` layout. See
`CHANGELOG.md` for the full breaking-change list.

## Uninstall

```bash
gimme-the-lint uninstall
```

Removes git hooks and a repo-root `gimme-the-lint.config.js`. Everything under
`.gtl/` (baselines, manifest, and a `.gtl/config.js`), linter configs, and
`.venv` are left in place — remove them manually if desired.
