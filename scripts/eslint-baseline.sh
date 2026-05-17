#!/usr/bin/env bash
# gimme-the-lint: baseline creator (thin shim).
#
# As of v2.0 baselines are produced by the Node engine (lib/baseline.js) via
# adapters, and the lint-to-the-future dependency has been removed. `baseline`
# captures every unit in the project regardless of language. This shim keeps
# the old script path working.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="${SCRIPT_DIR}/../bin/gimme-the-lint.js"

if [ -n "$GIMME_PROJECT_ROOT" ]; then
    cd "$GIMME_PROJECT_ROOT"
fi

exec node "$CLI" baseline "$@"
