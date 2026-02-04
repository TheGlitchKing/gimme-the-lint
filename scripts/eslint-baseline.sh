#!/usr/bin/env bash
# gimme-the-lint: ESLint Baseline Creator (Directory-Chunked, Test-Excluding)
# Purpose: Create baselines per directory for progressive linting (production code only)
# Usage: ./scripts/eslint-baseline.sh [directory]

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

echo -e "${BLUE}gimme-the-lint: ESLint Baseline Creator (Directory-Chunked)${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Detect frontend directory
if [ -d "${PROJECT_ROOT}/frontend/src" ]; then
    FRONTEND_DIR="${PROJECT_ROOT}/frontend"
    SRC_DIR="src"
elif [ -d "${PROJECT_ROOT}/src" ] && [ -f "${PROJECT_ROOT}/package.json" ]; then
    FRONTEND_DIR="${PROJECT_ROOT}"
    SRC_DIR="src"
else
    echo -e "${RED}✗ No frontend src directory found${NC}"
    exit 1
fi

LTTF_DIR="${FRONTEND_DIR}/.lttf"

# Check target
if [ -n "$1" ]; then
    TARGET_DIR="$1"
    echo -e "${YELLOW}Mode:${NC} Single directory baseline"
    echo -e "${YELLOW}Target:${NC} ${SRC_DIR}/${TARGET_DIR}"
else
    TARGET_DIR=""
    echo -e "${YELLOW}Mode:${NC} Full codebase baseline"
fi

cd "$FRONTEND_DIR"
mkdir -p "$LTTF_DIR"

# Auto-discover directories (exclude test directories)
echo -e "${BLUE}Auto-discovering directories in ${SRC_DIR}/ (excluding test directories)...${NC}"
mapfile -t ALL_DIRS < <(find "$SRC_DIR" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; 2>/dev/null | sort)

DIRECTORIES=()
for dir in "${ALL_DIRS[@]}"; do
    if [[ ! "$dir" =~ [Tt]est ]] && [[ "$dir" != "e2e" ]] && [[ "$dir" != "__tests__" ]] && [[ "$dir" != "node_modules" ]]; then
        DIRECTORIES+=("$dir")
    else
        echo -e "${YELLOW}⊘${NC}  Excluding: ${dir}"
    fi
done

if [ ${#DIRECTORIES[@]} -eq 0 ]; then
    echo -e "${RED}✗ No production directories found in ${SRC_DIR}/${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Found ${#DIRECTORIES[@]} production directories: ${DIRECTORIES[*]}"

# Baseline function
create_directory_baseline() {
    local dir=$1
    local dir_path="${SRC_DIR}/${dir}"

    if [ ! -d "$dir_path" ]; then
        echo -e "${YELLOW}⚠${NC}  Skipping ${dir} (not found)"
        return
    fi

    echo -e "\n${BLUE}Processing: ${dir}${NC}"

    if command -v npx &>/dev/null && npx lttf --version &>/dev/null 2>&1; then
        if npx lttf ignore --filter "${dir_path}/**/*.{js,jsx,ts,tsx}" 2>&1 | grep -v "^$"; then
            echo -e "${GREEN}✓${NC} Baseline created for ${dir}"
        else
            echo -e "${YELLOW}⚠${NC} No violations found in ${dir}"
        fi
    else
        echo -e "${YELLOW}⚠${NC} lint-to-the-future not available, using eslint JSON output"
        local baseline_file="${LTTF_DIR}/baseline-${dir}.json"

        if npx eslint "${dir_path}" --format=json > "$baseline_file" 2>/dev/null; then
            echo -e "${GREEN}✓${NC} No violations in ${dir}"
            rm -f "$baseline_file"
        else
            local violation_count=$(jq '[.[] | .messages | length] | add // 0' "$baseline_file" 2>/dev/null || echo "0")
            if [ "$violation_count" = "0" ]; then
                echo -e "${GREEN}✓${NC} No violations in ${dir}"
                rm -f "$baseline_file"
            else
                echo -e "${GREEN}✓${NC} Baseline created: ${violation_count} violations in ${dir}"
            fi
        fi
    fi
}

# Drift detection (compare old manifest)
MANIFEST_FILE="${LTTF_DIR}/.baseline-manifest.json"
DRIFT_LOGGED=false

if [ -f "$MANIFEST_FILE" ]; then
    OLD_DIRS=$(jq -r '.directories_baselined[]' "$MANIFEST_FILE" 2>/dev/null | sort)
    OLD_CONFIG_HASH=$(jq -r '.config_hash' "$MANIFEST_FILE" 2>/dev/null)
    OLD_VIOLATIONS=$(jq -r '.total_violations' "$MANIFEST_FILE" 2>/dev/null)
    OLD_TIMESTAMP=$(jq -r '.created_at' "$MANIFEST_FILE" 2>/dev/null)

    NEW_DIRS=$(printf '%s\n' "${DIRECTORIES[@]}" | sort)

    ESLINT_CONFIG=""
    for cfg in eslint.config.js eslint.config.mjs .eslintrc.js .eslintrc.json; do
        if [ -f "$cfg" ]; then
            ESLINT_CONFIG="$cfg"
            break
        fi
    done

    NEW_CONFIG_HASH="unknown"
    if [ -n "$ESLINT_CONFIG" ]; then
        NEW_CONFIG_HASH=$(md5sum "$ESLINT_CONFIG" 2>/dev/null | awk '{print $1}' || echo "unknown")
    fi

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
        [ "$CONFIG_CHANGED" = true ] && echo -e "${YELLOW}⚙  ESLint config changed${NC}"
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

echo -e "\n${YELLOW}Note:${NC} Test directories excluded from baselines"
echo "  Excluded: __tests__, testing, e2e, *test*"

# Create/update manifest
ESLINT_CONFIG=""
for cfg in eslint.config.js eslint.config.mjs .eslintrc.js .eslintrc.json; do
    if [ -f "$cfg" ]; then
        ESLINT_CONFIG="$cfg"
        break
    fi
done

CONFIG_HASH="unknown"
if [ -n "$ESLINT_CONFIG" ]; then
    CONFIG_HASH=$(md5sum "$ESLINT_CONFIG" 2>/dev/null | awk '{print $1}' || echo "unknown")
fi

LTTF_VERSION=$(npx lttf --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || echo 'unknown')

TOTAL_VIOLATIONS=0
if [ -d "$LTTF_DIR" ]; then
    for f in "$LTTF_DIR"/*.lint-todo "$LTTF_DIR"/baseline-*.json; do
        if [ -f "$f" ]; then
            if [[ "$f" == *.lint-todo ]]; then
                count=$(wc -l < "$f" 2>/dev/null || echo "0")
            else
                count=$(jq '[.[] | .messages | length] | add // 0' "$f" 2>/dev/null || echo "0")
            fi
            TOTAL_VIOLATIONS=$((TOTAL_VIOLATIONS + count))
        fi
    done
fi

cat > "$MANIFEST_FILE" <<EOF
{
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "tool": "eslint",
  "version": "$LTTF_VERSION",
  "directories_baselined": $(printf '%s\n' "${DIRECTORIES[@]}" | jq -R . | jq -s .),
  "total_directories": ${#DIRECTORIES[@]},
  "total_violations": $TOTAL_VIOLATIONS,
  "config_hash": "$CONFIG_HASH",
  "test_excluded": ["__tests__", "testing", "e2e", "*.test.*", "*.spec.*"]
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

echo ""
