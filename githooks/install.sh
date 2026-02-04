#!/usr/bin/env bash
# gimme-the-lint: Git Hooks Installer
# Usage: bash githooks/install.sh

set -e

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$PROJECT_ROOT" ]; then
    echo "Error: Not a git repository."
    exit 1
fi

HOOKS_DIR="${PROJECT_ROOT}/.git/hooks"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "gimme-the-lint: Installing git hooks..."

for hook in pre-commit pre-push; do
    src="${SCRIPT_DIR}/${hook}"
    dest="${HOOKS_DIR}/${hook}"

    if [ ! -f "$src" ]; then
        continue
    fi

    if [ -f "$dest" ]; then
        if ! grep -q "gimme-the-lint" "$dest"; then
            backup="${dest}.backup.$(date +%s)"
            cp "$dest" "$backup"
            echo "  Backed up existing ${hook} -> $(basename "$backup")"
        fi
    fi

    cp "$src" "$dest"
    chmod +x "$dest"
    echo "  Installed: ${hook}"
done

echo ""
echo "Git hooks installed!"
echo "  pre-commit: Lints changed files on commit"
echo "  pre-push:   Full lint on push"
echo ""
