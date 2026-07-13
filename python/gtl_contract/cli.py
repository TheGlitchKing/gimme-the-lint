"""The CLI — the wire between gtl-contract and the gimme-the-lint engine.

Contract with the Node adapter, and it is deliberately narrow:

    stdout  A single JSON object. Nothing else, ever.
    exit 0  We checked. `violations` may be empty (genuinely clean) or not.
    exit 1  We could NOT check. `skip` says why, `detail` usually has a traceback.
    exit 2  We were used wrong (bad flag, unknown provider).

The distinction between "checked and found nothing" and "could not check" is the
most important thing this file does. They are both "zero violations" on the wire,
and collapsing them would let a broken import masquerade as a clean bill of health
— a guard reporting green while guarding nothing, which is the exact failure the
whole tool exists to prevent. So `checked` is an explicit boolean, and the engine
maps `checked: false` onto its idempotent-skip contract: warn loudly, never block.

Diagnostics go to stderr. stdout carries JSON and only JSON, because anything else
on it makes us unparseable — and an unparseable linter is a silently absent one.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys

from . import config as config_mod
from . import providers, rules


@contextlib.contextmanager
def quarantined_stdout():
    """Redirect fd 1 to stderr while the application is being imported.

    We import somebody else's app, and applications talk. The first real codebase
    this ran against configured structlog at import time and wrote a JSON log line
    ("CORS configured for development...") straight to stdout — landing our report on
    line 2 and making the whole thing unparseable. The engine would have seen a
    linter that produced garbage, and a linter that produces garbage is a linter that
    is silently absent.

    We cannot control what an app prints when imported, so we isolate it instead. The
    redirect is at the FILE DESCRIPTOR level, not merely `sys.stdout`: a C extension
    (or anything that grabbed fd 1 before we did) writes to the descriptor directly
    and would sail straight past a Python-level swap.

    Their output is not discarded — it goes to stderr, where a human debugging a skip
    can still read it. It just does not get to sit on the wire.
    """
    sys.stdout.flush()
    saved = os.dup(1)
    try:
        os.dup2(2, 1)  # fd 1 -> stderr, for the duration
        yield
    finally:
        sys.stdout.flush()
        os.dup2(saved, 1)  # give the real stdout back
        os.close(saved)


def _emit(payload: dict) -> None:
    json.dump(payload, sys.stdout, indent=None, sort_keys=True)
    sys.stdout.write("\n")
    sys.stdout.flush()


def cmd_check(args: argparse.Namespace) -> int:
    root = os.path.abspath(args.root)
    cfg = config_mod.load(args.config)

    if args.provider:
        try:
            provider = providers.get(args.provider)
        except KeyError as e:
            print(str(e), file=sys.stderr)
            return 2
    else:
        provider = providers.detect(root, cfg)

    if provider is None:
        _emit(
            {
                "checked": False,
                "violations": [],
                "skip": "no supported model/schema stack found here",
                "provider": None,
            }
        )
        return 1

    # Everything the app might print at import happens inside here, and lands on
    # stderr. Our report is written after, to a stdout nobody else has touched.
    with quarantined_stdout():
        result = provider.check(root, cfg)

    _emit(
        {
            "checked": result.checked,
            "provider": provider.id,
            "violations": [v.to_json() for v in result.violations],
            "skip": result.skip,
            "detail": result.detail,
        }
    )
    return 0 if result.checked else 1


def cmd_rules(args: argparse.Namespace) -> int:
    """Dump the rule catalogue.

    The engine uses this to render `--explain`; a human uses it to find out why a
    rule exists before deleting it in frustration. `neverBaseline` is emitted here
    rather than hardcoded on the Node side, because rules belong to the provider —
    exactly as ESLint's rules belong to ESLint.
    """
    _emit(
        {
            "rules": [
                {
                    "id": r.id,
                    "summary": r.summary,
                    "incident": r.incident,
                    "neverBaseline": r.never_baseline,
                }
                for r in rules.ALL_RULES
            ]
        }
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="gtl-contract",
        description="Does your persistence model agree with the schemas that expose it?",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser("check", help="Check the entity contract")
    check.add_argument("--root", default=".", help="Project root (default: cwd)")
    check.add_argument("--config", default=None, help="Path to the JSON config")
    check.add_argument("--provider", default=None, help="Force a provider")
    check.set_defaults(func=cmd_check)

    rules_cmd = sub.add_parser("rules", help="Print the rule catalogue as JSON")
    rules_cmd.set_defaults(func=cmd_rules)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
