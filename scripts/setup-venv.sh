#!/usr/bin/env bash
# gimme-the-lint: Python Virtual Environment Setup
# Purpose: Create .venv and install linting dependencies (ruff, mypy, black)
# Usage: ./scripts/setup-venv.sh [project-root]

set -e

PROJECT_ROOT="${1:-$(pwd)}"
VENV_DIR="${PROJECT_ROOT}/.venv"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}gimme-the-lint: Python Environment Setup${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check Python version
PYTHON_CMD=""
for cmd in python3 python; do
    if command -v "$cmd" &> /dev/null; then
        VERSION=$("$cmd" --version 2>&1 | grep -oP '\d+\.\d+')
        MAJOR=$(echo "$VERSION" | cut -d'.' -f1)
        MINOR=$(echo "$VERSION" | cut -d'.' -f2)
        if [ "$MAJOR" -ge 3 ] && [ "$MINOR" -ge 8 ]; then
            PYTHON_CMD="$cmd"
            break
        fi
    fi
done

if [ -z "$PYTHON_CMD" ]; then
    echo -e "${RED}✗ Python 3.8+ not found${NC}"
    echo "  Please install Python 3.8 or later."
    exit 1
fi

echo -e "${GREEN}✓${NC} Python found: $($PYTHON_CMD --version)"

# Create venv if not exists
if [ ! -d "$VENV_DIR" ]; then
    echo -e "${BLUE}Creating virtual environment...${NC}"
    "$PYTHON_CMD" -m venv "$VENV_DIR"
    echo -e "${GREEN}✓${NC} Virtual environment created at $VENV_DIR"
else
    echo -e "${GREEN}✓${NC} Virtual environment already exists"
fi

# Activate and install dependencies
source "$VENV_DIR/bin/activate"

echo -e "${BLUE}Installing linting dependencies...${NC}"
pip install --quiet --upgrade pip

# Install from bundled requirements if available
BUNDLED_REQ="${SCRIPT_DIR}/../templates/requirements.linting.txt"
if [ -f "$BUNDLED_REQ" ]; then
    pip install --quiet -r "$BUNDLED_REQ"
    echo -e "${GREEN}✓${NC} Linting tools installed (ruff, mypy)"
fi

# If project has its own requirements, install those too
for reqfile in "${PROJECT_ROOT}/backend/requirements.txt" "${PROJECT_ROOT}/requirements.txt"; do
    if [ -f "$reqfile" ]; then
        echo -e "${BLUE}Installing project dependencies from $(basename "$reqfile")...${NC}"
        pip install --quiet -r "$reqfile" 2>/dev/null || echo -e "${YELLOW}⚠${NC} Some project deps failed (non-critical)"
        break
    fi
done

deactivate

echo ""
echo -e "${GREEN}✓ Python environment setup complete!${NC}"
echo "  Location: $VENV_DIR"
echo "  Tools:    ruff, mypy"
echo ""
