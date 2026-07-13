"""Materialize the API contract that only exists at runtime.

A code-first framework (FastAPI, Django REST, tRPC, Prisma) does not have an API
contract on disk. It has one in its head: FastAPI computes an OpenAPI document from
the Pydantic schemas and serves it at /openapi.json. The contract is real, it is
complete, and it is invisible to every tool that reads files.

Which means nothing stops a Pydantic field rename from silently breaking every client
of that endpoint. There is no artifact to diff, so there is no diff, so there is no
warning.

`materialize` writes it down. Once the document is a committed file, it can be
diffed against its own history like anything else, and a breaking change becomes a
reviewable line in a pull request instead of a 4am page.

## The provenance marker, and why it is load-bearing

The emitted document carries `x-generated-by: gimme-the-lint`.

That marker is what makes it safe to REGENERATE. A lockfile must always be rewritten
— a stale one describes an API you no longer serve, and a guard that reports on an
API you no longer serve is worse than no guard, because it is believed.

But a HAND-AUTHORED openapi.yaml (a schema-first project, where the spec is the
source of truth and the code is generated FROM it) must never be overwritten. Doing
so would destroy human work, silently, on a routine command.

Both failures are reachable from the same wrong assumption, in opposite directions.
So the mode is never guessed: no marker means authored, and authored is sacred.
"""

from __future__ import annotations

import importlib
import json
from typing import Any

GENERATED_BY = "gimme-the-lint"
MARKER = "x-generated-by"


def materialize(app_ref: str) -> dict[str, Any]:
    """Extract the OpenAPI document from a live ASGI app.

    `app_ref` is "module:attr" — e.g. "app.main:app".
    """
    module_name, _, attr = app_ref.partition(":")
    module = importlib.import_module(module_name)
    app = getattr(module, attr or "app")

    openapi = getattr(app, "openapi", None)
    if not callable(openapi):
        raise RuntimeError(
            f"{app_ref} has no callable .openapi() — is it a FastAPI/Starlette app?"
        )

    document = openapi()
    if not isinstance(document, dict):
        raise RuntimeError(f"{app_ref}.openapi() did not return a document")

    # Stamp it. Anything carrying this is ours to regenerate; anything without it was
    # written by a human and is not ours to touch.
    document[MARKER] = GENERATED_BY
    return document


def is_generated(document: dict[str, Any] | None) -> bool:
    """Did WE write this document?

    The question that decides whether the file may be overwritten. Answered by a
    marker rather than by inference, because inferring it wrong destroys either a
    guarantee or somebody's work.
    """
    return bool(document) and document.get(MARKER) == GENERATED_BY


def serialize(document: dict[str, Any]) -> str:
    """Stable, diffable text.

    sort_keys is not cosmetic: without it, a dict-ordering change between Python
    versions rewrites the whole file, and every diff becomes unreadable — so nobody
    reads them, and a real breaking change slides through in the noise.
    """
    return json.dumps(document, indent=2, sort_keys=True) + "\n"


def spec_quality(document: dict[str, Any]) -> list[dict[str, Any]]:
    """Rules about whether the spec is worth generating FROM.

    A lockfile can be perfectly fresh and still be worthless. These two rules decide
    whether anything downstream of it — a generated client, a breaking-change diff, an
    SDK — is guarding anything at all.

    ## route-without-response-model

    FastAPI cannot infer a response schema from a function that does not declare one, so
    it emits an EMPTY one. The spec then lies by omission, and every consumer inherits the
    lie: a code generator has nothing to work from and types the endpoint `any`, so the
    generated client compiles happily against a shape nobody has ever checked.

    You can have a perfect lockfile, a green codegen check, and no idea what a quarter of
    your API returns. **A perfect lockfile over an incomplete spec is a perfect record of
    a lie.**

    ## unstable-operation-id

    FastAPI derives operationId from the function name + path + method. Code generators
    turn operationId into the client method name. So renaming a Python handler — a pure
    refactor, touching no API surface — silently renames every client method that calls
    it, and ships as a breaking change to every consumer.

    One line at app construction fixes it repo-wide, so the message says that line.
    Reporting a problem without its one-line fix is just complaining.
    """
    findings: list[dict[str, Any]] = []
    paths = document.get("paths") or {}

    for route, methods in sorted(paths.items()):
        if not isinstance(methods, dict):
            continue
        for method, op in sorted(methods.items()):
            if method.lower() not in ("get", "post", "put", "patch", "delete"):
                continue
            if not isinstance(op, dict):
                continue

            key = f"{method.upper()} {route}"

            # --- an empty response schema ---
            responses = op.get("responses") or {}
            success = None
            for code in ("200", "201", "202", 200, 201, 202):
                if code in responses:
                    success = responses[code]
                    break

            if success is not None and not _has_schema(success):
                findings.append(
                    {
                        "rule": "openapi/route-without-response-model",
                        "key": f"{key}:no-response-model",
                        "message": (
                            f"{key} declares no response_model, so its response schema is "
                            f"EMPTY. Nothing downstream can know what this endpoint returns "
                            f"— a code generator will type it `any`, and the client will "
                            f"compile against a shape nobody has checked. Add "
                            f"`response_model=...` to the route."
                        ),
                    }
                )

            # --- an auto-derived operationId ---
            operation_id = op.get("operationId")
            if operation_id and _looks_auto_derived(operation_id, route, method):
                findings.append(
                    {
                        "rule": "openapi/unstable-operation-id",
                        "key": f"{key}:auto-operation-id",
                        "message": (
                            f"{key} uses FastAPI's auto-derived operationId "
                            f"(`{operation_id}`), which is built from the FUNCTION NAME. "
                            f"Rename the handler — a pure refactor touching no API — and "
                            f"every generated client method silently changes name, which "
                            f"ships as a breaking change to every consumer. Fix it "
                            f"repo-wide with one line: "
                            f"FastAPI(generate_unique_id_function=lambda route: route.name)"
                        ),
                    }
                )

    return findings


def _has_schema(response: Any) -> bool:
    """Does this response actually describe a shape?

    An empty `content`, or a content entry with no `schema`, is FastAPI saying "I do not
    know" — which is exactly the case worth catching, and exactly the case that reads as
    fine if you only check that a 200 exists.
    """
    if not isinstance(response, dict):
        return False
    content = response.get("content")
    if not content:
        return False
    for media in content.values():
        if isinstance(media, dict) and media.get("schema"):
            return True
    return False


def _looks_auto_derived(operation_id: str, route: str, method: str) -> bool:
    """FastAPI's default operationId is `<function_name>_<path>_<method>`.

    It is recognizable because it ENDS with a mangled form of the path and the method —
    e.g. `get_prospect_prospects__id__get`. A hand-set operationId (`getProspect`,
    `prospects.get`) does not carry its own route in its name.

    Deliberately conservative: a false positive here nags somebody who already did the
    right thing, and nagging people who did the right thing is how a rule gets disabled.
    """
    suffix = f"_{method.lower()}"
    if not operation_id.endswith(suffix):
        return False

    # The path, mangled the way FastAPI mangles it: / and {} → _
    mangled = route.replace("/", "_").replace("{", "_").replace("}", "_").replace("-", "_")
    return mangled.strip("_") in operation_id


def differs(a: dict[str, Any] | None, b: dict[str, Any] | None) -> bool:
    """Do two documents describe different APIs?

    The provenance marker is excluded — it says who wrote the file, not what the API
    is. Comparing it would make a hand-authored spec differ from its own regeneration
    for a reason that has nothing to do with the contract.
    """

    def strip(doc):
        if not doc:
            return None
        return {k: v for k, v in doc.items() if k != MARKER}

    return strip(a) != strip(b)
