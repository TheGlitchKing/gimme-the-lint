#!/usr/bin/env bash
# gimme-the-lint: progressive linting dashboard (thin shim).
#
# As of v2.0 the dashboard is rendered by the Node engine (lib/dashboard.js)
# from the global manifest at .gtl/manifest.json. This shim keeps the old
# script path working.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="${SCRIPT_DIR}/../bin/gimme-the-lint.js"

if [ -n "$GIMME_PROJECT_ROOT" ]; then
    cd "$GIMME_PROJECT_ROOT"
fi

exec node "$CLI" dashboard "$@"
