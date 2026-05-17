#!/usr/bin/env bash
# gimme-the-lint: progressive linting checks.
#
# This is a thin shim. As of v2.0 the progressive-lint engine lives in Node
# (lib/check.js) — gimme-the-lint owns its own baseline diffing and no longer
# shells out to lint-to-the-future. This script exists only so existing git
# hooks that call run-checks.sh keep working.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="${SCRIPT_DIR}/../bin/gimme-the-lint.js"

if [ -n "$GIMME_PROJECT_ROOT" ]; then
    cd "$GIMME_PROJECT_ROOT"
fi

exec node "$CLI" check "$@"
