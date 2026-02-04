#!/usr/bin/env bash
# gimme-the-lint: Ruff Baseline Creator (Directory-Chunked, Test-Excluding)
# Purpose: Create Ruff baselines per directory for progressive linting (production code only)
# Usage: ./scripts/ruff-baseline.sh [directory]

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
NC='\033[0m'

echo -e "${BLUE}gimme-the-lint: Ruff Baseline Creator (Directory-Chunked)${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Detect backend directory
if [ -d "${PROJECT_ROOT}/backend/app" ]; then
    BACKEND_DIR="${PROJECT_ROOT}/backend"
    APP_DIR="app"
elif [ -d "${PROJECT_ROOT}/app" ]; then
    BACKEND_DIR="${PROJECT_ROOT}"
    APP_DIR="app"
else
    echo -e "${RED}✗ No backend app directory found${NC}"
    exit 1
fi

LTTF_RUFF_DIR="${BACKEND_DIR}/.lttf-ruff"

if [ -n "$1" ]; then
    TARGET_DIR="$1"
    echo -e "${YELLOW}Mode:${NC} Single directory baseline"
    echo -e "${YELLOW}Target:${NC} ${APP_DIR}/${TARGET_DIR}"
else
    TARGET_DIR=""
    echo -e "${YELLOW}Mode:${NC} Full codebase baseline"
fi

cd "$BACKEND_DIR"
mkdir -p "$LTTF_RUFF_DIR"

# Check for venv and ruff
VENV_ACTIVATE="${PROJECT_ROOT}/.venv/bin/activate"
if [ ! -f "$VENV_ACTIVATE" ]; then
    echo -e "${RED}✗ Python .venv not found${NC}"
    echo "  Run: gimme-the-lint venv setup"
    exit 1
fi

source "$VENV_ACTIVATE"

if ! command -v ruff &> /dev/null; then
    echo -e "${RED}✗ Ruff not installed in .venv${NC}"
    echo "  Run: gimme-the-lint venv setup"
    deactivate
    exit 1
fi

echo -e "${GREEN}✓${NC} Ruff found: $(ruff --version)"

# Auto-discover directories
echo -e "${BLUE}Auto-discovering directories in ${APP_DIR}/ (excluding test directories)...${NC}"
mapfile -t ALL_DIRS < <(find "$APP_DIR" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; 2>/dev/null | sort)

DIRECTORIES=()
for dir in "${ALL_DIRS[@]}"; do
    if [[ ! "$dir" =~ [Tt]est ]] && [[ "$dir" != "__pycache__" ]]; then
        DIRECTORIES+=("$dir")
    else
        echo -e "${YELLOW}⊘${NC}  Excluding: ${dir}"
    fi
done

if [ ${#DIRECTORIES[@]} -eq 0 ]; then
    echo -e "${RED}✗ No production directories found in ${APP_DIR}/${NC}"
    deactivate
    exit 1
fi

echo -e "${GREEN}✓${NC} Found ${#DIRECTORIES[@]} production directories: ${DIRECTORIES[*]}"

# Baseline function
create_directory_baseline() {
    local dir=$1
    local dir_path="${APP_DIR}/${dir}"

    if [ ! -d "$dir_path" ]; then
        echo -e "${YELLOW}⚠${NC}  Skipping ${dir} (not found)"
        return
    fi

    echo -e "\n${BLUE}Processing: ${dir}${NC}"

    local py_count=$(find "$dir_path" -name "*.py" ! -name "test_*.py" ! -name "*_test.py" 2>/dev/null | wc -l)
    if [ "$py_count" -eq 0 ]; then
        echo -e "${YELLOW}⚠${NC}  No Python files in ${dir}"
        return
    fi

    local baseline_file="${LTTF_RUFF_DIR}/baseline-${dir}.json"

    if ruff check "$dir_path" \
        --output-format=json \
        --exclude "test_*.py" \
        --exclude "*_test.py" \
        > "$baseline_file" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} No violations in ${dir} (${py_count} files)"
        rm -f "$baseline_file"
    else
        local violation_count=$(jq '. | length' "$baseline_file" 2>/dev/null || echo "0")
        if [ "$violation_count" = "0" ] || [ -z "$violation_count" ]; then
            echo -e "${GREEN}✓${NC} No violations in ${dir} (${py_count} files)"
            rm -f "$baseline_file"
        else
            echo -e "${GREEN}✓${NC} Baseline: ${violation_count} violations in ${dir}"

            local temp_file="${baseline_file}.tmp"
            jq --arg dir "$dir" --arg count "$violation_count" --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
                '. | {directory: $dir, violation_count: ($count | tonumber), created_at: $date, violations: .}' \
                "$baseline_file" > "$temp_file" && mv "$temp_file" "$baseline_file"
        fi
    fi
}

# Drift detection
MANIFEST_FILE="${LTTF_RUFF_DIR}/.baseline-manifest.json"
DRIFT_LOGGED=false

if [ -f "$MANIFEST_FILE" ]; then
    OLD_DIRS=$(jq -r '.directories_baselined[]' "$MANIFEST_FILE" 2>/dev/null | sort)
    OLD_CONFIG_HASH=$(jq -r '.config_hash' "$MANIFEST_FILE" 2>/dev/null)
    OLD_VIOLATIONS=$(jq -r '.total_violations' "$MANIFEST_FILE" 2>/dev/null)
    OLD_TIMESTAMP=$(jq -r '.created_at' "$MANIFEST_FILE" 2>/dev/null)

    NEW_DIRS=$(printf '%s\n' "${DIRECTORIES[@]}" | sort)

    PYPROJECT="${PROJECT_ROOT}/pyproject.toml"
    NEW_CONFIG_HASH=$(md5sum "$PYPROJECT" 2>/dev/null | awk '{print $1}' || echo "unknown")

    ADDED_DIRS=$(comm -13 <(echo "$OLD_DIRS") <(echo "$NEW_DIRS"))
    REMOVED_DIRS=$(comm -23 <(echo "$OLD_DIRS") <(echo "$NEW_DIRS"))
    CONFIG_CHANGED=false
    [ "$OLD_CONFIG_HASH" != "$NEW_CONFIG_HASH" ] && CONFIG_CHANGED=true

    if [ -n "$ADDED_DIRS" ] || [ -n "$REMOVED_DIRS" ] || [ "$CONFIG_CHANGED" = true ]; then
        echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${CYAN}Auto-Healing: Baseline Drift Detected${NC}"
        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${BLUE}Previous baseline:${NC} $OLD_TIMESTAMP"
        DRIFT_LOGGED=true

        [ -n "$ADDED_DIRS" ] && echo -e "${GREEN}+ Added:${NC}" && echo "$ADDED_DIRS" | while read -r d; do echo "    $d"; done
        [ -n "$REMOVED_DIRS" ] && echo -e "${RED}- Removed:${NC}" && echo "$REMOVED_DIRS" | while read -r d; do echo "    $d"; done
        [ "$CONFIG_CHANGED" = true ] && echo -e "${YELLOW}⚙  Ruff config changed${NC}"
        echo ""
    fi
fi

# Main execution
if [ -n "$TARGET_DIR" ]; then
    create_directory_baseline "$TARGET_DIR"
else
    echo -e "\n${BLUE}Creating baselines for all production directories...${NC}"
    for dir in "${DIRECTORIES[@]}"; do
        create_directory_baseline "$dir"
    done
fi

echo -e "\n${YELLOW}Note:${NC} Test directories/files excluded"
echo "  Excluded: tests, *test*, __pycache__, test_*.py, *_test.py"

# Create/update manifest
PYPROJECT="${PROJECT_ROOT}/pyproject.toml"
CONFIG_HASH=$(md5sum "$PYPROJECT" 2>/dev/null | awk '{print $1}' || echo "unknown")
RUFF_VERSION=$(ruff --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || echo 'unknown')

TOTAL_VIOLATIONS=0
for baseline_file in "$LTTF_RUFF_DIR"/baseline-*.json; do
    if [ -f "$baseline_file" ]; then
        viol_count=$(jq -r '.violation_count' "$baseline_file" 2>/dev/null || echo "0")
        TOTAL_VIOLATIONS=$((TOTAL_VIOLATIONS + viol_count))
    fi
done

cat > "$MANIFEST_FILE" <<EOF
{
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "tool": "ruff",
  "version": "$RUFF_VERSION",
  "directories_baselined": $(printf '%s\n' "${DIRECTORIES[@]}" | jq -R . | jq -s .),
  "total_directories": ${#DIRECTORIES[@]},
  "total_violations": $TOTAL_VIOLATIONS,
  "config_hash": "$CONFIG_HASH",
  "test_excluded": ["tests", "*test*", "__pycache__"]
}
EOF

echo -e "\n${GREEN}✓${NC} Manifest updated: $MANIFEST_FILE"
echo "  Directories: ${#DIRECTORIES[@]} | Violations: $TOTAL_VIOLATIONS"

if [ "$DRIFT_LOGGED" = true ]; then
    echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✓ Auto-Healing Complete${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    if [ -n "$OLD_VIOLATIONS" ] && [ "$TOTAL_VIOLATIONS" != "$OLD_VIOLATIONS" ]; then
        DIFF=$((TOTAL_VIOLATIONS - OLD_VIOLATIONS))
        if [ $DIFF -gt 0 ]; then
            echo -e "${YELLOW}Violations increased: +$DIFF${NC}"
        else
            echo -e "${GREEN}Violations decreased: $DIFF${NC}"
        fi
    fi
fi

deactivate
echo ""
