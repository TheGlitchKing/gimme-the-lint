#!/usr/bin/env bash
# gimme-the-lint: Global Installation Script
# Usage: curl -fsSL https://raw.githubusercontent.com/TheGlitchKing/gimme-the-lint/main/install.sh | bash
# Or: ./install.sh [--scope user|project]

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCOPE="project"
for arg in "$@"; do
    case $arg in
        --scope) shift; SCOPE="$1"; shift ;;
        --scope=*) SCOPE="${arg#*=}" ;;
    esac
done

echo -e "${BLUE}gimme-the-lint: Installing...${NC}"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
    echo -e "${RED}Node.js not found. Please install Node.js 18+.${NC}"
    exit 1
fi

NODE_VERSION=$(node -v | grep -oP '\d+' | head -1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Node.js 18+ required. Found: $(node -v)${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Node.js $(node -v)"

# Install via npm
if [ "$SCOPE" = "user" ]; then
    echo -e "${BLUE}Installing globally...${NC}"
    npm install -g @theglitchking/gimme-the-lint
else
    echo -e "${BLUE}Installing as dev dependency...${NC}"
    npm install --save-dev @theglitchking/gimme-the-lint
fi

echo ""
echo -e "${GREEN}✓ gimme-the-lint installed!${NC}"
echo ""
echo "Next steps:"
if [ "$SCOPE" = "user" ]; then
    echo "  gimme-the-lint install    Initialize in current project"
else
    echo "  npx gimme-the-lint install    Initialize configs & venv"
fi
echo "  npx gimme-the-lint baseline   Create linting baselines"
echo "  npx gimme-the-lint hooks      Install git hooks"
echo ""
