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
import json
import os
import sys

from . import config as config_mod
from . import providers, rules


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
