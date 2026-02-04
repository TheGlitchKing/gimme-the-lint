#!/usr/bin/env bash
# gimme-the-lint: Uninstall Script
# Usage: ./uninstall.sh

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}gimme-the-lint: Uninstalling...${NC}"
echo ""

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Remove git hooks
for hook in pre-commit pre-push; do
    hookfile="${PROJECT_ROOT}/.git/hooks/${hook}"
    if [ -f "$hookfile" ] && grep -q "gimme-the-lint" "$hookfile"; then
        rm -f "$hookfile"
        # Restore backup if exists
        backup=$(ls -t "${hookfile}.backup."* 2>/dev/null | head -1)
        if [ -n "$backup" ]; then
            mv "$backup" "$hookfile"
            echo -e "${GREEN}✓${NC} Restored backup ${hook} hook"
        else
            echo -e "${GREEN}✓${NC} Removed ${hook} hook"
        fi
    fi
done

# Remove config file
if [ -f "${PROJECT_ROOT}/gimme-the-lint.config.js" ]; then
    rm -f "${PROJECT_ROOT}/gimme-the-lint.config.js"
    echo -e "${GREEN}✓${NC} Removed gimme-the-lint.config.js"
fi

# Uninstall npm package
if [ -d "${PROJECT_ROOT}/node_modules/@theglitchking/gimme-the-lint" ]; then
    npm uninstall @theglitchking/gimme-the-lint 2>/dev/null || true
    echo -e "${GREEN}✓${NC} Uninstalled npm package"
fi

echo ""
echo -e "${GREEN}✓ gimme-the-lint uninstalled${NC}"
echo ""
echo -e "${YELLOW}Note:${NC} The following were NOT removed (remove manually if desired):"
echo "  - .venv/ (Python virtual environment)"
echo "  - frontend/.lttf/ (ESLint baselines)"
echo "  - backend/.lttf-ruff/ (Ruff baselines)"
echo "  - eslint.config.js, pyproject.toml, .gitleaks.toml"
echo "  - .pre-commit-config.yaml, commitlint.config.js"
echo ""
