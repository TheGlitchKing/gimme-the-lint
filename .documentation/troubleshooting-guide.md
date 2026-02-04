# Troubleshooting Guide

## Installation Issues

### `npm install` fails with permission errors

**Symptom**: `EACCES` permission denied errors during install.

**Fix**: Don't use `sudo` with npm. Instead, fix npm permissions:
```bash
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
# Add the export to your .bashrc/.zshrc
```

Or use a Node version manager (nvm, fnm) which avoids permission issues entirely.

### `npx gimme-the-lint` command not found

**Symptom**: After installing, the CLI doesn't work.

**Fix**:
```bash
# If installed locally, use npx
npx gimme-the-lint --version

# If installed globally, check your PATH
npm root -g
# Ensure the bin directory from above is in your PATH

# Verify the package is installed
npm list @theglitchking/gimme-the-lint
```

### Python venv creation fails

**Symptom**: `init` fails during venv setup with Python errors.

**Fixes**:
```bash
# Check Python version (need 3.11+)
python3 --version

# If Python is missing or too old, install it:
# macOS:
brew install python@3.13

# Ubuntu/Debian:
sudo apt install python3.13 python3.13-venv

# Skip venv if you don't need Python linting:
npx gimme-the-lint init --skip-venv
```

### `postinstall` script warning about missing shebang

**Symptom**: npm shows warnings about `bin/gimme-the-lint.js` during install.

**Fix**: This is a cosmetic npm warning and doesn't affect functionality. The CLI works correctly.

---

## Linting Issues

### Pre-commit hook blocks commit but violations are old

**Symptom**: The pre-commit hook reports violations in code you didn't change.

**Causes**:
1. Baselines are stale or missing
2. Config changed since last baseline (config drift)
3. Files were staged that weren't expected

**Fix**:
```bash
# Check for drift
npx gimme-the-lint dashboard

# Re-run baselines to capture current state
npx gimme-the-lint baseline

# Commit the updated baselines
git add frontend/.lttf/ backend/.lttf-ruff/ .lttf-manifest.json
git commit -m "chore: update lint baselines"
```

### ESLint errors about missing parser or plugins

**Symptom**: ESLint fails with "Cannot find module" errors for TypeScript parser or plugins.

**Fix**: Install the required ESLint peer dependencies:
```bash
npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-plugin-react eslint-plugin-react-hooks eslint-plugin-import
```

If you're not using TypeScript or React, customize `eslint.config.js` to remove those plugins.

### Ruff not found in venv

**Symptom**: Backend linting fails with "ruff: command not found".

**Fix**:
```bash
# Recreate the venv
npx gimme-the-lint venv setup

# Or manually install ruff in the venv
source .venv/bin/activate
pip install ruff>=0.9.0 mypy>=1.15.0

# Verify
ruff --version
```

### Linting is too slow

**Symptom**: Pre-commit hook takes more than 60 seconds.

**Fixes**:
1. Ensure you're using progressive mode (default) — it only lints changed files
2. Check that ESLint cache is working: look for `.eslintcache` in your project
3. For large monorepos, use `--frontend-only` or `--backend-only` to scope checks
4. Exclude test files from production linting (already done by default)

```bash
# Time the check to identify the bottleneck
time npx gimme-the-lint check --verbose
```

---

## Drift Detection Issues

### "Directory drift detected" warning

**Symptom**: Dashboard shows directory drift — directories added or removed.

**What it means**: The project structure changed since the last baseline. New directories may have unlinted code.

**Fix**:
```bash
# Re-run baselines (auto-heals the manifest)
npx gimme-the-lint baseline

# The manifest will update with the new directory list
```

### "Config drift detected" warning

**Symptom**: Dashboard shows config drift — config hash mismatch.

**What it means**: `eslint.config.js` or `pyproject.toml` changed since the last baseline. Rules may have been added or removed.

**Fix**:
```bash
# Re-run baselines with the new config
npx gimme-the-lint baseline
```

### "Time drift detected" warning

**Symptom**: Dashboard shows baselines are older than 30 days.

**What it means**: It's been a while since baselines were refreshed. They may be inaccurate.

**Fix**:
```bash
# Refresh baselines
npx gimme-the-lint baseline

# This resets the timestamp in the manifest
```

### Manifest file is missing or corrupt

**Symptom**: Errors about `.lttf-manifest.json` not found or JSON parse errors.

**Fix**:
```bash
# Re-create from scratch
npx gimme-the-lint baseline

# This creates a new manifest with current state
```

---

## Git Hook Issues

### Hooks not running on commit

**Symptom**: You commit but no linting occurs.

**Fixes**:
```bash
# Check if hooks are installed
npx gimme-the-lint hooks status

# Reinstall hooks
npx gimme-the-lint hooks install

# Verify hooks exist in .git/hooks/
ls -la .git/hooks/pre-commit .git/hooks/pre-push

# Check hook is executable
chmod +x .git/hooks/pre-commit .git/hooks/pre-push
```

### Hooks conflict with existing hooks

**Symptom**: Installing gimme-the-lint hooks overwrites your existing hooks.

**What happens**: gimme-the-lint backs up existing hooks to `.git/hooks/pre-commit.backup` before installing.

**Fix**: If you need to run multiple hooks, create a wrapper script:
```bash
#!/bin/bash
# .git/hooks/pre-commit

# Run your existing hook
.git/hooks/pre-commit.backup

# Run gimme-the-lint
node_modules/.bin/gimme-the-lint check
```

### Hook works locally but not in CI

**Symptom**: Pre-commit hook catches violations locally but CI passes.

**Fix**: Git hooks don't run in CI. Use the GitHub Action instead:
```yaml
- uses: TheGlitchKing/gimme-the-lint@v1
  with:
    mode: progressive
```

---

## GitHub Action Issues

### Action fails with "gimme-the-lint not found"

**Symptom**: GitHub Action fails because it can't find the package.

**Fix**: Ensure `npm install` (or `npm ci`) runs before the action, or the action will fall back to running ESLint/Ruff directly. Check your workflow has:
```yaml
- uses: actions/checkout@v4
- run: npm ci
- uses: TheGlitchKing/gimme-the-lint@v1
```

### PR comment not appearing

**Symptom**: Action runs but no PR comment is posted.

**Fixes**:
1. Check workflow has `pull-requests: write` permission:
   ```yaml
   permissions:
     contents: read
     pull-requests: write
   ```
2. Ensure `comment-on-pr: true` is set (it's the default)
3. Check the action logs for GitHub API errors
4. Verify the `GITHUB_TOKEN` has write access to the repo

### Action shows stale results

**Symptom**: Action reports violations that were already fixed.

**Fix**: Ensure `fetch-depth: 0` is set on the checkout step for accurate change detection:
```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

---

## Python / Ruff Issues

### Ruff baseline shows zero violations but code has issues

**Symptom**: `baseline` completes but reports 0 violations, even though running `ruff check` shows errors.

**Fixes**:
```bash
# Ensure venv is active
source .venv/bin/activate

# Run ruff directly to compare
ruff check backend/ --output-format json

# Check pyproject.toml has the right rules configured
cat pyproject.toml | grep -A 20 '\[tool.ruff\]'
```

### mypy errors not caught by gimme-the-lint

**Note**: gimme-the-lint currently baselines ruff violations, not mypy. mypy is installed in the venv for your use but is not part of the progressive linting flow.

To run mypy separately:
```bash
source .venv/bin/activate
mypy backend/
```

---

## Common Error Messages

| Error | Cause | Fix |
|-------|-------|-----|
| `ENOENT: no such file or directory, open '.lttf-manifest.json'` | No baseline exists | Run `npx gimme-the-lint baseline` |
| `Python 3.11+ not found` | Python not installed or too old | Install Python 3.11+ |
| `Cannot find module 'eslint'` | ESLint not installed | `npm install eslint --save-dev` |
| `EACCES: permission denied` | File permission issue | Check `.git/hooks/` permissions, run `chmod +x` |
| `fatal: not a git repository` | Not in a git repo | Run `git init` first |
| `SyntaxError: Unexpected token` | Node.js too old | Upgrade to Node.js 18+ |

## Getting Help

If you encounter an issue not covered here:

1. Run `npx gimme-the-lint status` and `npx gimme-the-lint dashboard` to get diagnostic info
2. Check the [GitHub Issues](https://github.com/TheGlitchKing/gimme-the-lint/issues)
3. Open a new issue with:
   - Your Node.js version (`node --version`)
   - Your Python version (`python3 --version`)
   - Your OS and version
   - The full error output
   - Output of `npx gimme-the-lint status`
