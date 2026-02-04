#!/usr/bin/env bash
# gimme-the-lint: Progressive Linting Checks (Directory-Chunked)
# Purpose: Run progressive linting on CHANGED files only (optimized for pre-commit)
# Usage: ./scripts/run-checks.sh [--verbose] [--fix] [--frontend-only] [--backend-only] [--all]

set -e

# Resolve project root (where gimme-the-lint.config.js or package.json lives)
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

# Parse arguments
VERBOSE=false
FIX=false
FRONTEND_ONLY=false
BACKEND_ONLY=false
LINT_ALL=false

for arg in "$@"; do
    case $arg in
        --verbose) VERBOSE=true ;;
        --fix) FIX=true ;;
        --frontend-only) FRONTEND_ONLY=true ;;
        --backend-only) BACKEND_ONLY=true ;;
        --all) LINT_ALL=true ;;
        --help|-h)
            echo "gimme-the-lint: Progressive Linting Checks"
            echo ""
            echo "Usage: run-checks.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --verbose         Show detailed output"
            echo "  --fix             Auto-fix violations when possible"
            echo "  --frontend-only   Run only frontend checks"
            echo "  --backend-only    Run only backend checks"
            echo "  --all             Lint entire codebase (not just changed files)"
            echo "  --help, -h        Show this help"
            exit 0
            ;;
    esac
done

cd "$PROJECT_ROOT"

# Detect project structure
FRONTEND_DIR=""
BACKEND_DIR=""
FRONTEND_SRC=""
BACKEND_APP=""

if [ -d "frontend/src" ]; then
    FRONTEND_DIR="frontend"
    FRONTEND_SRC="frontend/src"
elif [ -d "src" ] && [ -f "package.json" ]; then
    FRONTEND_DIR="."
    FRONTEND_SRC="src"
fi

if [ -d "backend/app" ]; then
    BACKEND_DIR="backend"
    BACKEND_APP="backend/app"
elif [ -d "app" ] && ([ -f "pyproject.toml" ] || [ -f "requirements.txt" ]); then
    BACKEND_DIR="."
    BACKEND_APP="app"
fi

# Detect changed files (staged for commit)
CHANGED_FRONTEND_FILES=()
CHANGED_BACKEND_FILES=()

if [ "$LINT_ALL" = false ]; then
    echo -e "${BLUE}Detecting changed files (directory-chunked optimization)...${NC}"

    mapfile -t STAGED_FILES < <(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)

    if [ ${#STAGED_FILES[@]} -eq 0 ]; then
        echo -e "${YELLOW}No staged files detected, falling back to full lint${NC}"
        LINT_ALL=true
    else
        for file in "${STAGED_FILES[@]}"; do
            if [ -n "$FRONTEND_DIR" ] && [[ "$file" == ${FRONTEND_DIR}/* ]] && [[ "$file" =~ \.(js|jsx|ts|tsx)$ ]]; then
                CHANGED_FRONTEND_FILES+=("$file")
            elif [ -n "$BACKEND_DIR" ] && [[ "$file" == ${BACKEND_DIR}/* ]] && [[ "$file" =~ \.py$ ]]; then
                CHANGED_BACKEND_FILES+=("$file")
            fi
        done

        echo -e "${GREEN}✓${NC} Staged files: ${#STAGED_FILES[@]} total"
        echo -e "  ${CYAN}Frontend:${NC} ${#CHANGED_FRONTEND_FILES[@]} files"
        echo -e "  ${CYAN}Backend:${NC} ${#CHANGED_BACKEND_FILES[@]} files"
    fi
else
    echo -e "${YELLOW}Linting entire codebase (--all flag)${NC}"
fi

# Show dashboard if available
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/dashboard.sh" ]; then
    echo ""
    bash "$SCRIPT_DIR/dashboard.sh" 2>/dev/null || true
    echo ""
fi

# Drift Detection: Check changed files against baseline manifests
FRONTEND_MANIFEST=""
BACKEND_MANIFEST=""

if [ -n "$FRONTEND_DIR" ]; then
    FRONTEND_MANIFEST="${PROJECT_ROOT}/${FRONTEND_DIR}/.lttf/.baseline-manifest.json"
fi
if [ -n "$BACKEND_DIR" ]; then
    BACKEND_MANIFEST="${PROJECT_ROOT}/${BACKEND_DIR}/.lttf-ruff/.baseline-manifest.json"
fi

DRIFT_DETECTED=false

if [ -f "$FRONTEND_MANIFEST" ] && [ ${#CHANGED_FRONTEND_FILES[@]} -gt 0 ]; then
    mapfile -t CHANGED_DIRS < <(printf '%s\\n' "${CHANGED_FRONTEND_FILES[@]}" | sed "s|^${FRONTEND_DIR}/src/||" | cut -d'/' -f1 | sort -u)
    if [ ${#CHANGED_DIRS[@]} -gt 0 ]; then
        BASELINE_DIRS=$(jq -r '.directories_baselined[]' "$FRONTEND_MANIFEST" 2>/dev/null | sort)
        for dir in "${CHANGED_DIRS[@]}"; do
            if [ -n "$dir" ] && ! echo "$BASELINE_DIRS" | grep -q "^${dir}$"; then
                if [ "$DRIFT_DETECTED" = false ]; then
                    echo -e "${YELLOW}Directory Drift Detected${NC}"
                    DRIFT_DETECTED=true
                fi
                echo -e "${YELLOW}  New directory:${NC} ${FRONTEND_SRC}/${dir} (not in baseline)"
            fi
        done
    fi
fi

if [ -f "$BACKEND_MANIFEST" ] && [ ${#CHANGED_BACKEND_FILES[@]} -gt 0 ]; then
    mapfile -t CHANGED_DIRS < <(printf '%s\\n' "${CHANGED_BACKEND_FILES[@]}" | sed "s|^${BACKEND_DIR}/app/||" | cut -d'/' -f1 | sort -u)
    if [ ${#CHANGED_DIRS[@]} -gt 0 ]; then
        BASELINE_DIRS=$(jq -r '.directories_baselined[]' "$BACKEND_MANIFEST" 2>/dev/null | sort)
        for dir in "${CHANGED_DIRS[@]}"; do
            if [ -n "$dir" ] && ! echo "$BASELINE_DIRS" | grep -q "^${dir}$"; then
                if [ "$DRIFT_DETECTED" = false ]; then
                    echo -e "${YELLOW}Directory Drift Detected${NC}"
                    DRIFT_DETECTED=true
                fi
                echo -e "${YELLOW}  New directory:${NC} ${BACKEND_APP}/${dir} (not in baseline)"
            fi
        done
    fi
fi

if [ "$DRIFT_DETECTED" = true ]; then
    echo -e "${BLUE}Tip:${NC} Update baselines: gimme-the-lint baseline"
    echo ""
fi

# Frontend Progressive Linting
FRONTEND_EXIT=0
if [ "$BACKEND_ONLY" = false ] && [ -n "$FRONTEND_DIR" ]; then
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}Frontend ESLint (Progressive Mode)${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    if [ "$LINT_ALL" = false ] && [ ${#CHANGED_FRONTEND_FILES[@]} -eq 0 ]; then
        echo -e "${GREEN}✓ Skipping frontend (no changed files)${NC}"
    else
        cd "${PROJECT_ROOT}/${FRONTEND_DIR}"

        LINT_TARGET=""
        if [ "$LINT_ALL" = true ]; then
            LINT_TARGET="src/"
        else
            LINT_TARGET=$(printf '%s\n' "${CHANGED_FRONTEND_FILES[@]}" | sed "s|^${FRONTEND_DIR}/||" | tr '\n' ' ')
        fi

        if [ "$FIX" = true ]; then
            echo -e "${BLUE}Auto-fixing violations...${NC}"
            npx eslint --fix $LINT_TARGET 2>/dev/null || true
        fi

        if [ "$VERBOSE" = true ]; then
            npx eslint $LINT_TARGET || FRONTEND_EXIT=$?
        else
            npx eslint $LINT_TARGET > /tmp/gimme-frontend-lint.log 2>&1 || FRONTEND_EXIT=$?
            if [ $FRONTEND_EXIT -ne 0 ]; then
                cat /tmp/gimme-frontend-lint.log
            fi
        fi

        cd "$PROJECT_ROOT"

        if [ $FRONTEND_EXIT -eq 0 ]; then
            echo -e "${GREEN}✓ Frontend: No new violations${NC}"
        else
            echo -e "${RED}✗ Frontend: New violations detected${NC}"
        fi
    fi
fi

# Backend Progressive Linting
BACKEND_EXIT=0
if [ "$FRONTEND_ONLY" = false ] && [ -n "$BACKEND_DIR" ]; then
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}Backend Ruff (Progressive Mode)${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    if [ "$LINT_ALL" = false ] && [ ${#CHANGED_BACKEND_FILES[@]} -eq 0 ]; then
        echo -e "${GREEN}✓ Skipping backend (no changed files)${NC}"
    else
        # Activate venv
        VENV_ACTIVATE="${PROJECT_ROOT}/.venv/bin/activate"
        if [ -f "$VENV_ACTIVATE" ]; then
            source "$VENV_ACTIVATE"
        else
            echo -e "${RED}✗ Python .venv not found. Run: gimme-the-lint venv setup${NC}"
            BACKEND_EXIT=1
        fi

        if [ $BACKEND_EXIT -eq 0 ]; then
            LINT_TARGET=""
            if [ "$LINT_ALL" = true ]; then
                LINT_TARGET="${BACKEND_APP}/"
            else
                LINT_TARGET=$(printf '%s\n' "${CHANGED_BACKEND_FILES[@]}" | tr '\n' ' ')
            fi

            if [ "$FIX" = true ]; then
                echo -e "${BLUE}Auto-fixing violations...${NC}"
                ruff check $LINT_TARGET --fix 2>/dev/null || true
            fi

            if [ "$VERBOSE" = true ]; then
                ruff check $LINT_TARGET || BACKEND_EXIT=$?
            else
                ruff check $LINT_TARGET > /tmp/gimme-backend-lint.log 2>&1 || BACKEND_EXIT=$?
                if [ $BACKEND_EXIT -ne 0 ]; then
                    cat /tmp/gimme-backend-lint.log
                fi
            fi

            deactivate 2>/dev/null || true
        fi

        if [ $BACKEND_EXIT -eq 0 ]; then
            echo -e "${GREEN}✓ Backend: No new violations${NC}"
        else
            echo -e "${RED}✗ Backend: New violations detected${NC}"
        fi
    fi
fi

# Summary
echo ""
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${MAGENTA}gimme-the-lint Summary${NC}"
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [ $FRONTEND_EXIT -eq 0 ] && [ $BACKEND_EXIT -eq 0 ]; then
    echo -e "${GREEN}All checks passed! No new violations.${NC}"
    echo -e "${GREEN}✓ Safe to commit${NC}"
    exit 0
else
    echo -e "${RED}Violations detected - commit blocked${NC}"
    echo ""
    echo -e "${BLUE}Next Steps:${NC}"
    echo ""
    echo -e "${GREEN}STEP 1:${NC} Run auto-fix"
    echo "  gimme-the-lint check --fix"
    echo ""
    echo -e "${GREEN}STEP 2:${NC} Re-stage and retry"
    echo "  git add <fixed-files>"
    echo "  git commit -m \"your message\""
    echo ""
    echo -e "${BLUE}For LLMs (Claude Code):${NC}"
    echo "  AUTOMATICALLY run: gimme-the-lint check --fix"
    echo "  Re-stage files and retry commit"
    echo "  ONLY ask user if manual fixes needed after auto-fix"
    echo ""
    exit 1
fi
