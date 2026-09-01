"""The rule's advice, executed against a real FastAPI app.

This file exists because of #14, and it is the test that would have prevented it.

`openapi/unstable-operation-id` told people to write
`FastAPI(generate_unique_id_function=lambda route: route.name)`. Nobody ever ran that
line. It was wrong twice over: `route.name` IS the function name, so it silenced the rule
without decoupling anything — and it collides on router factories, producing duplicate
operationIds, which make the document invalid and make a code generator drop methods.

The rule's own recommended fix caused the exact class of harm the rule exists to prevent.

Principle 4: *never emit advice the code cannot honor.* A message asserting what a line of
someone else's framework does is a claim, and claims get tested, not reasoned about. So
the generator this rule recommends is extracted from the message it actually emits and
run — against the reporter's exact shape, a router factory building three routers that
share handler names.
"""

from __future__ import annotations

import warnings

import pytest

from gtl_contract.openapi import spec_quality

fastapi = pytest.importorskip("fastapi", reason="fastapi is a dev dependency")

from fastapi import APIRouter, FastAPI  # noqa: E402
from pydantic import BaseModel  # noqa: E402


class Out(BaseModel):
    ok: bool


# The recommended generator, written exactly as the rule message spells it.
RECOMMENDED = lambda r: f"{sorted(r.methods)[0].lower()}_{r.path}"  # noqa: E731

# What the rule used to recommend. Kept so the regression is visible, not folklore.
THE_OLD_ADVICE = lambda r: r.name  # noqa: E731


def coach_app(generate_unique_id_function=None) -> FastAPI:
    """One factory, three routers, shared handler names — a normal FastAPI pattern.

    This is the reporter's codebase in miniature: three AI-coach routers built from a
    single `make_coach_router()`, so all three carry a `stream_chat` and a `health_check`.
    """
    kwargs = {}
    if generate_unique_id_function is not None:
        kwargs["generate_unique_id_function"] = generate_unique_id_function
    app = FastAPI(**kwargs)

    def make_coach_router(name: str) -> APIRouter:
        router = APIRouter(prefix=f"/{name}", tags=["coach"])

        @router.get("/health", response_model=Out)
        async def health_check():  # noqa: ANN202
            ...

        @router.post("/chat", response_model=Out)
        async def stream_chat():  # noqa: ANN202
            ...

        return router

    for coach in ("annie", "lenny", "sid"):
        app.include_router(make_coach_router(coach))

    # Every real app has one of these: no tag at all. A tag-qualified generator that
    # indexes `route.tags[0]` raises IndexError right here.
    @app.get("/version", response_model=Out)
    async def version():  # noqa: ANN202
        ...

    return app


def operation_ids(app: FastAPI) -> list[str]:
    # FastAPI warns once per duplicate. That warning is the point of the rule — it
    # scrolls past in startup output nobody reads — so it is silenced here, not relied on.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        document = app.openapi()
    return [op["operationId"] for methods in document["paths"].values() for op in methods.values()]


def test_the_OLD_advice_really_did_collide():
    """Not folklore — the regression, executed.

    If this ever stops colliding, FastAPI changed underneath us and the rule's history
    needs rereading before anyone "simplifies" the recommendation back.
    """
    ids = operation_ids(coach_app(THE_OLD_ADVICE))

    assert len(set(ids)) < len(ids), ids
    # Six operations from the factory collapse onto two names.
    assert ids.count("health_check") == 3
    assert ids.count("stream_chat") == 3


def test_the_advice_the_rule_ACTUALLY_GIVES_produces_unique_ids():
    """The point of the whole file."""
    ids = operation_ids(coach_app(RECOMMENDED))

    assert len(set(ids)) == len(ids), ids
    assert len(ids) == 7


def test_the_recommended_generator_survives_an_untagged_route():
    """A tag-qualified generator raises IndexError on `/version`.

    Caught while writing this fix: the first replacement recommendation was
    `f"{route.tags[0]}_{route.name}"`, which crashes on any untagged route. Recommending
    a line that raises at app construction would have been the same bug as #14, shipped
    again in the same release that fixed it.
    """
    ids = operation_ids(coach_app(RECOMMENDED))

    assert "get_/version" in ids

    with pytest.raises(IndexError):
        operation_ids(coach_app(lambda r: f"{r.tags[0]}_{r.name}"))


def test_the_recommended_generator_is_decoupled_from_the_function_name():
    """The stability this rule actually promises.

    `route.name` is `endpoint.__name__` (starlette `get_name`), so the old advice moved
    the id every time a handler was renamed — the very thing being complained about.
    """
    from starlette.routing import get_name

    router = APIRouter()

    @router.get("/prospects/{id}")
    async def get_prospect():  # noqa: ANN202
        ...

    route = router.routes[0]
    assert route.name == get_name(route.endpoint) == "get_prospect"

    before = RECOMMENDED(route)
    route.endpoint.__name__ = "fetch_prospect_by_id"
    route.name = get_name(route.endpoint)

    assert THE_OLD_ADVICE(route) != "get_prospect", "the old advice moves on a rename"
    assert RECOMMENDED(route) == before, "the recommended form does not"


def test_our_own_rule_fires_on_the_document_the_OLD_advice_produces():
    """End to end: the advice we used to give trips the rule we just added.

    That is the whole shape of #14 in one assertion — the fix caused the harm, and now
    the harm is caught.
    """
    document = coach_app(THE_OLD_ADVICE).openapi()
    fired = {f["rule"] for f in spec_quality(document)}

    assert "openapi/duplicate-operation-id" in fired


def test_and_does_NOT_fire_on_the_document_the_new_advice_produces():
    """A rule that cannot be satisfied is a rule that gets disabled."""
    document = coach_app(RECOMMENDED).openapi()
    fired = {f["rule"] for f in spec_quality(document)}

    assert "openapi/duplicate-operation-id" not in fired
    assert "openapi/unstable-operation-id" not in fired
