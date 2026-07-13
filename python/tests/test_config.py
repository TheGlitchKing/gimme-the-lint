"""Authored decisions — and the reason that makes them decisions rather than shrugs.

A violation can persist two ways, and the difference is the whole point:

    baseline (generated)  DEBT      "nobody has looked at this yet"      no reason
    config   (authored)   DECISION  "we looked, and it is deliberate"    REASON REQUIRED

An unexplained omission is indistinguishable from the bug it is hiding. That is why
the reason is mandatory and why it has a minimum length: "n/a" is not a reason, and
a config full of "n/a" is a config nobody reads.
"""

from __future__ import annotations

from gtl_contract import rules as R

from .conftest import keys_for, rule_ids, run


def broken(**overrides):
    return run("brokenapp", app="brokenapp.main:app", **overrides)


# --- exceptions actually suppress ------------------------------------------------


def test_intentionally_absent_suppresses_the_finding():
    """The escape hatch works — otherwise nobody would adopt this."""
    result = broken(
        entities={
            "Deal": {
                "intentionallyAbsent": {
                    "operating_expenses": "Set only by the nightly underwriting job; a "
                    "client that could forge it could forge the deal's economics.",
                }
            }
        }
    )
    assert "Deal.operating_expenses:writable" not in keys_for(result, R.COLUMN_NOT_WRITABLE.id)


def test_server_managed_suppresses_the_finding():
    result = broken(entities={"Deal": {"serverManaged": ["internal_score"]}})
    assert "Deal.internal_score:writable" not in keys_for(result, R.COLUMN_NOT_WRITABLE.id)
    assert "Deal.internal_score:readable" not in keys_for(result, R.COLUMN_NOT_READABLE.id)


def test_pinning_a_request_body_suppresses_it():
    """The calculator input writes no table and never will. Pinning it is honest."""
    result = broken(unauditedRequestBodies=["BRRRRCalculatorRequest", "UpdateTierRequest"])
    assert R.UNREGISTERED_WRITE_SURFACE.id not in rule_ids(result)


def test_a_classified_model_is_skipped_entirely():
    result = broken(
        classifications={
            "Deal": {
                "kind": "triage",
                "reason": "GH-1234: real write schemas, never audited. Being brought under "
                "contract in phase 3.",
            }
        }
    )
    assert not any(v.fingerprint_key.startswith("Deal.") for v in result.violations)


# --- but the escape hatch is not a loophole --------------------------------------


def test_an_exception_with_no_reason_is_itself_a_violation():
    """You may declare an exception. You may not decline to explain it."""
    result = broken(entities={"Deal": {"intentionallyAbsent": {"operating_expenses": ""}}})
    assert "Deal.operating_expenses:reason" in keys_for(result, R.EXCEPTION_WITHOUT_REASON.id)


def test_a_throwaway_reason_is_rejected():
    """"n/a" is not a reason. Neither is "legacy", "TODO", or "see ticket"."""
    for excuse in ("n/a", "TODO", "legacy", "ask Bob"):
        result = broken(
            entities={"Deal": {"intentionallyAbsent": {"operating_expenses": excuse}}}
        )
        assert "Deal.operating_expenses:reason" in keys_for(
            result, R.EXCEPTION_WITHOUT_REASON.id
        ), f"{excuse!r} was accepted as a justification"


def test_a_classification_with_no_real_reason_is_a_violation():
    result = broken(classifications={"Deal": {"kind": "triage", "reason": "meh"}})
    assert "Deal:classification-reason" in keys_for(result, R.EXCEPTION_WITHOUT_REASON.id)


def test_an_unknown_classification_kind_is_rejected():
    """`telemetry` and `triage` are the only two. "wontfix" is not a classification."""
    result = broken(
        classifications={
            "Deal": {"kind": "wontfix", "reason": "we simply do not wish to think about it"}
        }
    )
    assert "Deal:classification-kind" in keys_for(result, R.EXCEPTION_WITHOUT_REASON.id)


def test_reason_rules_are_never_baselineable():
    """Baselining "this exception has no reason" would defeat the rule completely."""
    assert R.EXCEPTION_WITHOUT_REASON.never_baseline is True
    assert R.STALE_EXCEPTION.never_baseline is True


# --- a stale exception is a lie left behind by a deletion ------------------------


def test_an_exception_for_a_column_that_no_longer_exists_is_caught():
    result = broken(
        entities={
            "Deal": {
                "intentionallyAbsent": {
                    "column_we_deleted_last_year": "It was removed in the great renaming, "
                    "and this line was not.",
                }
            }
        }
    )
    assert "Deal.column_we_deleted_last_year:stale-absent" in keys_for(result, R.STALE_EXCEPTION.id)


def test_an_exception_for_a_model_that_no_longer_exists_is_caught():
    result = broken(entities={"Ghost": {"serverManaged": ["id"]}})
    assert "Ghost:entity-override" in keys_for(result, R.STALE_EXCEPTION.id)


def test_a_classification_for_a_model_that_no_longer_exists_is_caught():
    result = broken(
        classifications={
            "Ghost": {"kind": "telemetry", "reason": "This model was deleted three releases ago."}
        }
    )
    assert "Ghost:classification" in keys_for(result, R.STALE_EXCEPTION.id)


def test_a_needless_classification_is_caught():
    """AuditLog has no write surface. Classifying it is diligence theatre.

    A needless exception is not harmless: it trains people to add more, and a config
    full of noise is a config nobody reads — which is how the exceptions that MATTER
    stop being read too.
    """
    result = broken(
        classifications={
            "AuditLog": {
                "kind": "telemetry",
                "reason": "Audit rows are written by the server and never by a client.",
            }
        }
    )
    assert "AuditLog:needless-classification" in keys_for(result, R.STALE_EXCEPTION.id)


# --- config parsing --------------------------------------------------------------


def test_camelCase_and_snake_case_are_both_accepted():
    """The config is authored in JavaScript but consumed by Python.

    Being strict about the casing would be a rule with no bug behind it.
    """
    from gtl_contract.config import from_dict

    camel = from_dict({"entities": {"Deal": {"serverManaged": ["x"], "intentionallyAbsent": {"y": "r"}}}})
    snake = from_dict({"entities": {"Deal": {"server_managed": ["x"], "intentionally_absent": {"y": "r"}}}})

    assert camel.override_for("Deal").server_managed == snake.override_for("Deal").server_managed
    assert camel.override_for("Deal").intentionally_absent == snake.override_for("Deal").intentionally_absent


def test_timestamps_are_server_managed_by_default():
    """Requiring every entity to declare created_at/updated_at would be pure noise."""
    from gtl_contract.config import Config

    assert "created_at" in Config().server_managed
    assert "updated_at" in Config().server_managed
