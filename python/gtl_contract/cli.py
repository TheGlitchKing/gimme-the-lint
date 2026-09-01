"""The CLI — the wire between gtl-contract and the gimme-the-lint engine.

Contract with the Node adapter, and it is deliberately narrow:

    stdout  A single JSON object. Nothing else, ever.
    exit 0  We checked. `violations` may be empty (genuinely clean) or not.
    exit 1  We could NOT check. `skip` says why, `detail` usually has a traceback.
    exit 2  We were used wrong (bad flag, unknown provider).
    exit 3  We checked and FOUND violations. Only ever returned with --exit-code.

The distinction between "checked and found nothing" and "could not check" is the
most important thing this file does. They are both "zero violations" on the wire,
and collapsing them would let a broken import masquerade as a clean bill of health
— a guard reporting green while guarding nothing, which is the exact failure the
whole tool exists to prevent. So `checked` is an explicit boolean, and the engine
maps `checked: false` onto its idempotent-skip contract: warn loudly, never block.

## Why "found violations" is 3 and not 1 (#17)

Exiting non-zero on a non-empty `violations` list is the obvious fix, and it is
wrong: it collides "we found something" with "we could not look". Those are the two
facts this protocol exists to keep apart, and `lib/adapters/contract.js` reads exit 1
as `checked:false` — so a run that found 137 real violations would be reported to the
engine as a SKIP, warned about, and never blocked on. The suggested fix would have
turned a working gate into a silent one.

So the new code is 3, it is opt-in, and the default is unchanged. The engine never
passes --exit-code; it reads `checked` and `violations` off the JSON, which is
richer than any exit status. The flag exists for people wiring this into CI directly
— which is a real need, because the check imports the app and the only runner with
the app's Python dependencies is often not the one with Node on it.

Diagnostics go to stderr. stdout carries JSON and only JSON, because anything else
on it makes us unparseable — and an unparseable linter is a silently absent one.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys
import traceback

from . import config as config_mod
from . import openapi as openapi_mod
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
    return _status(result.checked, result.violations, getattr(args, "exit_code", False))


def _status(checked: bool, violations: list, exit_code: bool) -> int:
    """The exit status, in one place, so `check` and `openapi` cannot disagree.

    Order matters: `checked` is asked FIRST. A run that could not look must report 1
    whatever --exit-code says, because "we could not look" outranks "we found nothing"
    — collapsing those two is the failure this whole tool exists to prevent.
    """
    if not checked:
        return 1
    if exit_code and violations:
        return 3
    return 0


def cmd_openapi(args: argparse.Namespace) -> int:
    """Emit the API contract that otherwise exists only at runtime.

    Two modes, and the difference matters enormously:

      --emit     print the document. The engine writes it where it belongs.
      (default)  COMPARE the live document against the committed lockfile, and report
                 a violation if they disagree.

    That comparison is what makes the whole lockfile trustworthy. Without it a
    developer renames a Pydantic field, never regenerates, and the committed lockfile
    goes on asserting the old shape forever — so the breaking-change check downstream
    is comparing two identical stale files and cheerfully reporting no breakage. The
    guard goes inert and still shows green. It is `npm ci` refusing a stale
    package-lock.json, and for exactly the same reason.
    """
    root = os.path.abspath(args.root)
    cfg = config_mod.load(args.config)

    if root not in sys.path:
        sys.path.insert(0, root)

    app_ref = cfg.app or args.app
    if not app_ref:
        _emit({"checked": False, "violations": [], "skip": "no app configured (contract.app)"})
        return 1

    try:
        with quarantined_stdout():
            document = openapi_mod.materialize(app_ref)
    except Exception:
        _emit(
            {
                "checked": False,
                "violations": [],
                "skip": f"could not materialize the OpenAPI document from {app_ref}",
                "detail": traceback.format_exc(limit=6),
            }
        )
        return 1

    if args.emit:
        sys.stdout.write(openapi_mod.serialize(document))
        return 0

    # Compare against the committed lockfile.
    committed = None
    if args.lockfile and os.path.exists(args.lockfile):
        try:
            with open(args.lockfile, "r", encoding="utf-8") as fh:
                committed = json.load(fh)
        except Exception:
            committed = None

    violations = []

    if committed is None:
        violations.append(
            {
                "file": args.lockfile or "openapi.json",
                "line": 0,
                "ruleId": "contract/lockfile-missing",
                "severity": "error",
                "message": (
                    "No API contract lockfile. Your API's shape exists only at runtime, so "
                    "nothing can tell you when a change breaks a client. Run: "
                    "gimme-the-lint materialize"
                ),
                "fingerprintKey": "openapi:lockfile-missing",
                "neverBaseline": rules.BY_ID["contract/lockfile-missing"].never_baseline,
                "source": "contract",
            }
        )
    elif not openapi_mod.is_generated(committed):
        # A hand-authored spec. It is the source of truth, not our output — we do not
        # own it and will never rewrite it. But if the code now serves something
        # DIFFERENT from what the spec promises, that disagreement is the single most
        # valuable thing we can report: a published contract that has quietly stopped
        # describing the implementation.
        if openapi_mod.differs(committed, document):
            violations.append(
                {
                    "file": args.lockfile,
                    "line": 0,
                    "ruleId": "contract/spec-implementation-mismatch",
                    "severity": "error",
                    "message": (
                        f"{args.lockfile} is hand-authored (it carries no generated-by marker), "
                        "and the API your code actually serves no longer matches it. The "
                        "published contract and the implementation have drifted apart. Neither "
                        "file has been touched — fix whichever one is wrong."
                    ),
                    "fingerprintKey": "openapi:spec-implementation-mismatch",
                    "neverBaseline": rules.BY_ID["contract/spec-implementation-mismatch"].never_baseline,
                    "source": "contract",
                }
            )
    elif openapi_mod.differs(committed, document):
        violations.append(
            {
                "file": args.lockfile,
                "line": 0,
                "ruleId": "contract/lockfile-stale",
                "severity": "error",
                "message": (
                    "The API contract lockfile no longer matches the code. You changed a "
                    "schema without regenerating it, so the lockfile is asserting an API you "
                    "no longer serve — and the breaking-change check is comparing two stale "
                    "files and finding nothing wrong. Run: gimme-the-lint materialize"
                ),
                "fingerprintKey": "openapi:lockfile-stale",
                    "neverBaseline": rules.BY_ID["contract/lockfile-stale"].never_baseline,
                "source": "contract",
            }
        )

    # SPEC QUALITY — and this is not a footnote.
    #
    # A lockfile can be perfectly fresh and still be worthless. A route with no
    # response_model emits an EMPTY response schema, so a code generator types the whole
    # endpoint `any` and the client compiles against a shape nobody has ever checked. You
    # can have a green lockfile, a green codegen check, and no idea what a quarter of your
    # API returns.
    #
    # A perfect lockfile over an incomplete spec is a perfect record of a lie.
    for finding in openapi_mod.spec_quality(document):
        violations.append(
            {
                "file": args.lockfile or "openapi.json",
                "line": 0,
                "ruleId": finding["rule"],
                "severity": "error",
                "message": finding["message"],
                # Identity is the ROUTE, not the file or the message: every one of these
                # findings lives in the same lockfile, so a file-keyed identity would
                # collapse 65 distinct routes into one.
                "fingerprintKey": finding["key"],
                # DEBT, and it must be. 65 of 244 routes on the first real codebase — if
                # this could not be grandfathered, adopting the tool would mean fixing 65
                # routes before your next commit, and nobody does that; they uninstall.
                "neverBaseline": rules.BY_ID[finding["rule"]].never_baseline,
                "source": "openapi",
            }
        )

    _emit({"checked": True, "provider": "openapi", "violations": violations, "skip": None})
    return _status(True, violations, getattr(args, "exit_code", False))


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
    check.add_argument("--exit-code", action="store_true", help="Exit 3 when the check succeeds but finds violations (default: exit 0 — findings are reported on stdout, not in the status). Use this when wiring gtl-contract into CI directly. Exit 1 still means COULD NOT CHECK, never 'found something'.")
    check.set_defaults(func=cmd_check)

    api = sub.add_parser("openapi", help="Materialize or verify the API contract lockfile")
    api.add_argument("--root", default=".", help="Project root (default: cwd)")
    api.add_argument("--config", default=None, help="Path to the JSON config")
    api.add_argument("--app", default=None, help='ASGI app ref, e.g. "app.main:app"')
    api.add_argument("--lockfile", default=None, help="Path to the committed lockfile")
    api.add_argument(
        "--emit",
        action="store_true",
        help="Print the document instead of comparing it (used by `materialize`)",
    )
    api.add_argument("--exit-code", action="store_true", help="Exit 3 when the check succeeds but finds violations (default: exit 0 — findings are reported on stdout, not in the status). Use this when wiring gtl-contract into CI directly. Exit 1 still means COULD NOT CHECK, never 'found something'.")
    api.set_defaults(func=cmd_openapi)

    rules_cmd = sub.add_parser("rules", help="Print the rule catalogue as JSON")
    rules_cmd.set_defaults(func=cmd_rules)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
