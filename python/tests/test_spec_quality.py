"""Is the spec worth generating FROM?

A lockfile can be perfectly fresh and completely worthless. These two rules decide
whether anything downstream of it — a generated client, a breaking-change diff, an SDK —
is guarding anything at all.

You can have a green lockfile check, a green codegen check, and no idea what a quarter of
your API returns.

**A perfect lockfile over an incomplete spec is a perfect record of a lie.**
"""

from __future__ import annotations

from gtl_contract import rules as R
from gtl_contract.openapi import spec_quality


def doc(paths: dict) -> dict:
    return {"openapi": "3.1.0", "info": {"title": "t", "version": "1"}, "paths": paths}


def rules_fired(findings) -> list[str]:
    return [f["rule"] for f in findings]


# --- route-without-response-model -------------------------------------------------


def test_a_route_with_no_response_model_is_caught():
    """65 of 244 routes on the first real codebase.

    FastAPI cannot infer a response schema from a function that does not declare one, so
    it emits an EMPTY one. A code generator then has nothing to work from and types the
    whole endpoint `any` — and the client compiles happily against a shape nobody has ever
    checked.
    """
    findings = spec_quality(
        doc(
            {
                "/deals": {
                    "get": {
                        "operationId": "listDeals",
                        # A 200 with no content at all: FastAPI saying "I do not know".
                        "responses": {"200": {"description": "Successful Response"}},
                    }
                }
            }
        )
    )

    assert "openapi/route-without-response-model" in rules_fired(findings)
    assert "GET /deals:no-response-model" in [f["key"] for f in findings]


def test_content_with_no_schema_is_also_caught():
    """The subtle version, and the one that reads as fine if you only check for a 200."""
    findings = spec_quality(
        doc(
            {
                "/deals": {
                    "get": {
                        "operationId": "listDeals",
                        "responses": {
                            "200": {"description": "ok", "content": {"application/json": {}}}
                        },
                    }
                }
            }
        )
    )

    assert "openapi/route-without-response-model" in rules_fired(findings)


def test_a_route_WITH_a_response_schema_is_clean():
    """A rule that fires on correct code is a rule people disable."""
    findings = spec_quality(
        doc(
            {
                "/deals": {
                    "get": {
                        "operationId": "listDeals",
                        "responses": {
                            "200": {
                                "description": "ok",
                                "content": {
                                    "application/json": {
                                        "schema": {"$ref": "#/components/schemas/Deal"}
                                    }
                                },
                            }
                        },
                    }
                }
            }
        )
    )

    assert "openapi/route-without-response-model" not in rules_fired(findings)


def test_it_is_DEBT_so_a_real_codebase_can_adopt_this():
    """65 findings on day one.

    If this could not be grandfathered, adopting the tool would mean fixing 65 routes
    before your next commit. Nobody does that. They uninstall.
    """
    assert R.ROUTE_WITHOUT_RESPONSE_MODEL.never_baseline is False


# --- unstable-operation-id ---------------------------------------------------------


def test_fastapis_auto_derived_operation_id_is_caught():
    """244 of 244 routes on the first real codebase.

    FastAPI derives operationId from the function name + path + method, and code
    generators turn operationId into the CLIENT METHOD NAME. So renaming a Python handler
    — a pure refactor, touching no API surface — silently renames every client method that
    calls it, and ships as a breaking change to every consumer.
    """
    findings = spec_quality(
        doc(
            {
                "/prospects/{id}": {
                    "get": {
                        # Exactly what FastAPI generates: function name, then the mangled
                        # path, then the method.
                        "operationId": "get_prospect_prospects__id__get",
                        "responses": {
                            "200": {
                                "description": "ok",
                                "content": {"application/json": {"schema": {"type": "object"}}},
                            }
                        },
                    }
                }
            }
        )
    )

    assert "openapi/unstable-operation-id" in rules_fired(findings)


def test_the_message_carries_the_fix():
    """Reporting a problem without its fix is just complaining."""
    findings = spec_quality(
        doc(
            {
                "/prospects/{id}": {
                    "get": {
                        "operationId": "get_prospect_prospects__id__get",
                        "responses": {
                            "200": {
                                "description": "ok",
                                "content": {"application/json": {"schema": {"type": "object"}}},
                            }
                        },
                    }
                }
            }
        )
    )

    message = next(f["message"] for f in findings if "auto-operation-id" in f["key"])
    assert "generate_unique_id_function" in message


def test_the_message_no_longer_recommends_the_generator_that_COLLIDES():
    """#14: `lambda route: route.name` was the recommendation, and it was wrong twice.

    `route.name` IS the function name (starlette `get_name` returns `__name__`), so it
    silenced this rule without decoupling anything the rule complains about. And it
    collides on router factories — a normal FastAPI pattern — producing duplicate
    operationIds, which make the document invalid and cause a generator to drop methods.

    The rule's own fix caused the exact harm the rule exists to prevent. Guidance must be
    true (principle 4), so this pins that it is no longer offered bare.
    """
    findings = spec_quality(
        doc(
            {
                "/prospects/{id}": {
                    "get": {
                        "operationId": "get_prospect_prospects__id__get",
                        "responses": {
                            "200": {
                                "description": "ok",
                                "content": {"application/json": {"schema": {"type": "object"}}},
                            }
                        },
                    }
                }
            }
        )
    )
    message = next(f["message"] for f in findings if "auto-operation-id" in f["key"])

    # It may be NAMED, but only as the thing not to do.
    assert "Do NOT use `lambda r: r.name`" in message
    # And the form it recommends instead is keyed on method+path, which is unique by
    # construction — path plus method is what makes an operation unique to begin with.
    assert "r.path" in message and "r.methods" in message


def test_a_hand_set_operation_id_is_clean():
    """A hand-set operationId does not carry its own route in its name.

    Deliberately conservative: a false positive here nags somebody who already did the
    right thing, and nagging people who did the right thing is how a rule gets disabled.
    """
    for good in ("getProspect", "prospects.get", "readProspectById"):
        findings = spec_quality(
            doc(
                {
                    "/prospects/{id}": {
                        "get": {
                            "operationId": good,
                            "responses": {
                                "200": {
                                    "description": "ok",
                                    "content": {
                                        "application/json": {"schema": {"type": "object"}}
                                    },
                                }
                            },
                        }
                    }
                }
            )
        )
        assert "openapi/unstable-operation-id" not in rules_fired(findings), good


# --- both -------------------------------------------------------------------------


def test_a_clean_spec_produces_nothing():
    findings = spec_quality(
        doc(
            {
                "/deals": {
                    "post": {
                        "operationId": "createDeal",
                        "responses": {
                            "201": {
                                "description": "ok",
                                "content": {"application/json": {"schema": {"type": "object"}}},
                            }
                        },
                    }
                }
            }
        )
    )

    assert findings == []


def test_identity_is_the_ROUTE_not_the_file():
    """Every one of these findings lives in the same lockfile.

    A file-keyed identity would collapse 65 distinct routes into one violation — you would
    baseline "the lockfile has a problem" and never hear about the other 64.
    """
    findings = spec_quality(
        doc(
            {
                "/a": {"get": {"operationId": "a", "responses": {"200": {"description": "x"}}}},
                "/b": {"get": {"operationId": "b", "responses": {"200": {"description": "x"}}}},
            }
        )
    )

    keys = {f["key"] for f in findings}
    assert "GET /a:no-response-model" in keys
    assert "GET /b:no-response-model" in keys
    assert len(keys) == 2, "two routes must be two findings"


# --- duplicate-operation-id -------------------------------------------------------
#
# #14. The rule above, held to its own standard: our recommended fix produced these,
# and nothing caught them. The reporter had to write their own test to find out.


def two_coaches(op_id_a: str, op_id_b: str) -> dict:
    """The reporter's exact shape: one router factory, two coaches, one handler name."""
    ok = {
        "200": {
            "description": "ok",
            "content": {"application/json": {"schema": {"type": "object"}}},
        }
    }
    return doc(
        {
            "/annie/health": {"get": {"operationId": op_id_a, "responses": ok}},
            "/lenny/health": {"get": {"operationId": op_id_b, "responses": ok}},
        }
    )


def test_two_routes_sharing_an_operation_id_are_caught():
    """15 routes onto 5 ids on the reporting codebase, and the document is invalid.

    A generator collides or silently drops all but one, so a client compiles fine
    against an endpoint it can no longer call.
    """
    findings = spec_quality(two_coaches("health_check", "health_check"))

    assert "openapi/duplicate-operation-id" in rules_fired(findings)


def test_it_reports_ONCE_PER_ID_naming_every_colliding_route():
    """You fix a collision once, at the generator — not once per route.

    But the message has to name the routes, or the finding is unactionable without
    opening the document.
    """
    findings = spec_quality(two_coaches("health_check", "health_check"))
    dupes = [f for f in findings if f["rule"] == "openapi/duplicate-operation-id"]

    assert len(dupes) == 1, [f["key"] for f in dupes]
    assert dupes[0]["key"] == "health_check:duplicate-operation-id"
    assert "GET /annie/health" in dupes[0]["message"]
    assert "GET /lenny/health" in dupes[0]["message"]


def test_distinct_operation_ids_are_clean():
    """The whole point of qualifying the generator."""
    findings = spec_quality(two_coaches("annie_health_check", "lenny_health_check"))

    assert "openapi/duplicate-operation-id" not in rules_fired(findings)


def test_identity_is_the_ID_so_the_finding_survives_a_route_joining_the_collision():
    """Keyed on the operationId, not the routes.

    A path-keyed identity would evaporate the moment a fourth coach joined the
    collision, resurrecting a grandfathered finding as brand new.
    """
    two = spec_quality(two_coaches("health_check", "health_check"))
    ok = {
        "200": {
            "description": "ok",
            "content": {"application/json": {"schema": {"type": "object"}}},
        }
    }
    three = spec_quality(
        doc(
            {
                "/annie/health": {"get": {"operationId": "health_check", "responses": ok}},
                "/lenny/health": {"get": {"operationId": "health_check", "responses": ok}},
                "/sid/health": {"get": {"operationId": "health_check", "responses": ok}},
            }
        )
    )

    key = lambda fs: [f["key"] for f in fs if f["rule"] == "openapi/duplicate-operation-id"]
    assert key(two) == key(three) == ["health_check:duplicate-operation-id"]


def test_it_is_DEBT_because_WE_caused_it():
    """Not a defect, and the reason is unusually direct.

    FastAPI's default generator includes the path and never collides. So a duplicate is
    almost always the fingerprint of a custom generate_unique_id_function — most often
    the one THIS RULE used to recommend. Shipping a defect that blocks people on a patch
    upgrade for following our own documented advice is indefensible, and principle 2 says
    a check that cannot be grandfathered blocks adoption on day one.
    """
    assert R.DUPLICATE_OPERATION_ID.never_baseline is False


def test_a_route_with_no_operation_id_at_all_does_not_collide_with_another():
    """Absent is not a value. Two routes with no operationId are not duplicates."""
    ok = {
        "200": {
            "description": "ok",
            "content": {"application/json": {"schema": {"type": "object"}}},
        }
    }
    findings = spec_quality(
        doc(
            {
                "/a": {"get": {"responses": ok}},
                "/b": {"get": {"responses": ok}},
            }
        )
    )

    assert "openapi/duplicate-operation-id" not in rules_fired(findings)
