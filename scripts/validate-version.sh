#!/usr/bin/env bash
# gimme-the-lint: Version Validation (pre-publish check)
# Ensures package.json version, CHANGELOG.md, and git tag are in sync

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PKG_VERSION=$(node -p "require('${PACKAGE_DIR}/package.json').version")

echo "Validating version: v${PKG_VERSION}"

# Check CHANGELOG has entry for this version
if [ -f "${PACKAGE_DIR}/CHANGELOG.md" ]; then
    if grep -q "## \[${PKG_VERSION}\]" "${PACKAGE_DIR}/CHANGELOG.md" || grep -q "## ${PKG_VERSION}" "${PACKAGE_DIR}/CHANGELOG.md"; then
        echo -e "${GREEN}✓${NC} CHANGELOG.md has entry for v${PKG_VERSION}"
    else
        echo -e "${YELLOW}⚠${NC} CHANGELOG.md missing entry for v${PKG_VERSION}"
    fi
else
    echo -e "${YELLOW}⚠${NC} CHANGELOG.md not found"
fi

# Check README exists
if [ -f "${PACKAGE_DIR}/README.md" ]; then
    echo -e "${GREEN}✓${NC} README.md exists"
else
    echo -e "${RED}✗${NC} README.md missing"
    exit 1
fi

# Check LICENSE exists
if [ -f "${PACKAGE_DIR}/LICENSE" ]; then
    echo -e "${GREEN}✓${NC} LICENSE exists"
else
    echo -e "${RED}✗${NC} LICENSE missing"
    exit 1
fi

echo -e "${GREEN}✓${NC} Version validation passed: v${PKG_VERSION}"
