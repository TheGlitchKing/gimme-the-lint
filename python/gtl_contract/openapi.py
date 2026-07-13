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
