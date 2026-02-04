#!/usr/bin/env bash
# gimme-the-lint: Progressive Linting Dashboard
# Purpose: Show progressive linting progress across entire codebase
# Usage: ./scripts/dashboard.sh

set -e

if [ -n "$GIMME_PROJECT_ROOT" ]; then
    PROJECT_ROOT="$GIMME_PROJECT_ROOT"
else
    PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

echo -e "${MAGENTA}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${MAGENTA}║       ${BLUE}gimme-the-lint Progressive Linting Dashboard${MAGENTA}            ║${NC}"
echo -e "${MAGENTA}║       ${CYAN}(Directory-Chunked, Production Code Only)${MAGENTA}              ║${NC}"
echo -e "${MAGENTA}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Generated:${NC} $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

cd "$PROJECT_ROOT"

# Detect project structure
FRONTEND_DIR=""
BACKEND_DIR=""

if [ -d "frontend/src" ]; then
    FRONTEND_DIR="frontend"
elif [ -d "src" ] && [ -f "package.json" ]; then
    FRONTEND_DIR="."
fi

if [ -d "backend/app" ]; then
    BACKEND_DIR="backend"
elif [ -d "app" ] && ([ -f "pyproject.toml" ] || [ -f "requirements.txt" ]); then
    BACKEND_DIR="."
fi

# Helper: show manifest status
show_manifest_status() {
    local label="$1"
    local manifest_path="$2"
    local src_path="$3"
    local config_file="$4"

    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}${label}${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    if [ -f "$manifest_path" ]; then
        echo -e "${GREEN}✓${NC} Baselines active"

        CREATED_AT=$(jq -r '.created_at' "$manifest_path" 2>/dev/null || echo "unknown")
        TOTAL_DIRS=$(jq -r '.total_directories' "$manifest_path" 2>/dev/null || echo "0")
        TOTAL_VIOLS=$(jq -r '.total_violations' "$manifest_path" 2>/dev/null || echo "0")

        # Calculate age
        BASELINE_AGE="unknown"
        if command -v python3 &>/dev/null && [ "$CREATED_AT" != "unknown" ]; then
            BASELINE_AGE=$(python3 -c "
from datetime import datetime
try:
    created = datetime.fromisoformat('$CREATED_AT'.replace('Z', '+00:00'))
    print((datetime.now(created.tzinfo) - created).days)
except:
    print('unknown')
" 2>/dev/null || echo "unknown")
        fi

        echo "  Created:    $CREATED_AT (${BASELINE_AGE} days ago)"
        echo "  Directories: $TOTAL_DIRS baselined"
        echo "  Violations:  $TOTAL_VIOLS"

        # Directory drift
        if [ -d "$src_path" ]; then
            CURRENT_DIRS=$(find "$src_path" -mindepth 1 -maxdepth 1 -type d ! -name "__pycache__" ! -name "__tests__" ! -name "testing" ! -name "e2e" ! -name "node_modules" 2>/dev/null | grep -v -i test | wc -l)
            if [ "$CURRENT_DIRS" -gt "$TOTAL_DIRS" ]; then
                DRIFT=$((CURRENT_DIRS - TOTAL_DIRS))
                echo -e "  ${YELLOW}⚠  Drift: +${DRIFT} new directories detected${NC}"
            fi
        fi

        # Time drift
        if [ "$BASELINE_AGE" != "unknown" ] && [ "$BASELINE_AGE" -gt 30 ]; then
            echo -e "  ${YELLOW}⚠  Baseline is ${BASELINE_AGE} days old${NC}"
        fi

        # Config drift
        if [ -f "$config_file" ]; then
            CURRENT_HASH=$(md5sum "$config_file" 2>/dev/null | awk '{print $1}')
            BASELINE_HASH=$(jq -r '.config_hash' "$manifest_path" 2>/dev/null)
            if [ -n "$CURRENT_HASH" ] && [ "$CURRENT_HASH" != "$BASELINE_HASH" ]; then
                echo -e "  ${YELLOW}⚠  Linter config changed since baseline${NC}"
            fi
        fi
    else
        echo -e "${YELLOW}⊘${NC} No baselines created yet"
        echo "  Run: gimme-the-lint baseline"
    fi
    echo ""
}

# Frontend section
if [ -n "$FRONTEND_DIR" ]; then
    FRONTEND_MANIFEST="${PROJECT_ROOT}/${FRONTEND_DIR}/.lttf/.baseline-manifest.json"
    FRONTEND_SRC="${PROJECT_ROOT}/${FRONTEND_DIR}/src"
    FRONTEND_CONFIG="${PROJECT_ROOT}/${FRONTEND_DIR}/eslint.config.js"
    show_manifest_status "Frontend (ESLint)" "$FRONTEND_MANIFEST" "$FRONTEND_SRC" "$FRONTEND_CONFIG"
fi

# Backend section
if [ -n "$BACKEND_DIR" ]; then
    BACKEND_MANIFEST="${PROJECT_ROOT}/${BACKEND_DIR}/.lttf-ruff/.baseline-manifest.json"
    BACKEND_SRC="${PROJECT_ROOT}/${BACKEND_DIR}/app"
    BACKEND_CONFIG="${PROJECT_ROOT}/pyproject.toml"
    show_manifest_status "Backend (Ruff)" "$BACKEND_MANIFEST" "$BACKEND_SRC" "$BACKEND_CONFIG"
fi

# No linting detected
if [ -z "$FRONTEND_DIR" ] && [ -z "$BACKEND_DIR" ]; then
    echo -e "${YELLOW}No frontend or backend directories detected.${NC}"
    echo "  Expected: frontend/src/ or src/ (JS/TS)"
    echo "  Expected: backend/app/ or app/ (Python)"
    echo ""
fi

# Overall summary
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${MAGENTA}Overall Status${NC}"
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

has_baselines=false
if [ -n "$FRONTEND_DIR" ] && [ -f "${PROJECT_ROOT}/${FRONTEND_DIR}/.lttf/.baseline-manifest.json" ]; then
    has_baselines=true
fi
if [ -n "$BACKEND_DIR" ] && [ -f "${PROJECT_ROOT}/${BACKEND_DIR}/.lttf-ruff/.baseline-manifest.json" ]; then
    has_baselines=true
fi

if [ "$has_baselines" = true ]; then
    echo -e "${GREEN}✓ Progressive linting is active${NC}"
    echo ""
    echo -e "${BLUE}Commands:${NC}"
    echo "  gimme-the-lint check       Run progressive checks"
    echo "  gimme-the-lint check --fix Auto-fix violations"
    echo "  gimme-the-lint baseline    Refresh baselines"
else
    echo -e "${YELLOW}⚠ No baselines found${NC}"
    echo ""
    echo -e "${BLUE}Quick start:${NC}"
    echo "  gimme-the-lint install     Initialize configs"
    echo "  gimme-the-lint baseline    Create baselines"
    echo "  gimme-the-lint hooks       Install git hooks"
fi

echo ""
