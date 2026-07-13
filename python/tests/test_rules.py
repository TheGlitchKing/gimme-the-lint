"""Every rule, tested against the bug it was written for.

The strongest possible test of a rule is the defect it exists to catch. Each test
below rebuilds a real, shipped production bug and asserts the rule fires on it —
and then asserts, on the clean fixture, that the rule SHUTS UP once the bug is
fixed. Both halves matter: a rule that fires on correct code gets disabled, and a
disabled rule guards nothing.
"""

from __future__ import annotations

import pytest

from gtl_contract import rules as R

from .conftest import keys_for, rule_ids


# --- #974: the property form that saved four of twelve fields --------------------


def test_column_no_write_schema_accepts_is_caught(broken):
    """A user filled in twelve fields and four were persisted. The API said 201."""
    assert "Deal.operating_expenses:writable" in keys_for(broken, R.COLUMN_NOT_WRITABLE.id)


def test_column_no_response_returns_is_caught(broken):
    """A real column that no client can ever read."""
    assert "Deal.internal_score:readable" in keys_for(broken, R.COLUMN_NOT_READABLE.id)


def test_create_and_update_disagreeing_is_caught(broken):
    """`purchase_price` could be set on create and never changed. Nobody declared that."""
    assert "Deal.purchase_price:create-only" in keys_for(broken, R.CREATE_UPDATE_DISAGREE.id)


def test_json_column_typed_as_str_is_caught(broken):
    """The landmine with a fuse: harmless until someone writes CORRECT data."""
    assert "Deal.units_details:response-type" in keys_for(broken, R.RESPONSE_TYPE_MISMATCH.id)


# --- #998A: every conversation 500'd, forever ------------------------------------


def test_unaliased_metadata_is_caught(broken):
    """`metadata` reads SQLAlchemy's MetaData registry, not a column. 500 on every read."""
    assert "Conversation.metadata:reserved" in keys_for(broken, R.RESERVED_METADATA_UNALIASED.id)


# --- #998B: Save wiped every line item's notes -----------------------------------


def test_create_time_default_on_update_schema_is_caught(broken):
    """The 200 that destroys data. An update schema's default overwrites stored values."""
    keys = keys_for(broken, R.UPDATE_HAS_CREATE_DEFAULT.id)
    assert "BudgetLineItem.BudgetLineItemUpdate.status:update-default" in keys


def test_a_none_default_on_update_is_NOT_flagged(broken):
    """`None` is fine: exclude_unset distinguishes "not sent" from "explicitly null".

    Flagging it would make the rule unsatisfiable for every optional field in every
    update schema — which is how a good rule becomes a disabled one.
    """
    keys = keys_for(broken, R.UPDATE_HAS_CREATE_DEFAULT.id)
    assert not any("notes" in k for k in keys)
    assert not any("amount" in k for k in keys)


# --- the mechanism behind all of it ---------------------------------------------


def test_non_strict_write_schema_is_caught(broken):
    """extra='ignore' is what makes every other bug here SILENT."""
    keys = keys_for(broken, R.WRITE_SCHEMA_NOT_STRICT.id)
    assert "BudgetLineItem.BudgetLineItemUpdate:strict" in keys


def test_write_validator_on_response_is_caught(broken):
    """A validator on the read path: one legacy row 500s the endpoint."""
    keys = keys_for(broken, R.RESPONSE_INHERITS_WRITE_VALIDATOR.id)
    assert "Deal._validate_name:read-validator" in keys


# --- #1003: the entities nobody knew were entities -------------------------------


def test_non_conventional_request_body_is_caught(broken):
    """THE case that justifies importing the app instead of parsing it.

    `UpdateTierRequest` writes organizations.tier. It is not called
    `OrganizationUpdate`, so a name-based scan reports that table as having no
    client write surface and moves on — a miss invisible to itself. Only the route
    table knows the truth.
    """
    keys = keys_for(broken, R.UNREGISTERED_WRITE_SURFACE.id)
    assert "UpdateTierRequest:request-body" in keys


def test_drifted_duplicate_class_is_caught(broken):
    """Two DocumentResponses with different fields: the app is already lying."""
    keys = keys_for(broken, R.DUPLICATE_SCHEMA_CLASS_DRIFTED.id)
    assert "DocumentResponse:duplicate-drifted" in keys


# --- the negative case: a server-only table costs nobody anything ----------------


def test_a_model_with_no_write_surface_is_silent(broken):
    """AuditLog has no schemas. Nothing can drift, so it needs no config at all.

    This is DERIVED, not declared. If a new server-only table (an audit log, a
    queue, an ETL watermark) demanded a config entry, people would stop adding
    tables — or stop running the checker.
    """
    assert not any("AuditLog" in v.fingerprint_key for v in broken.violations)


# --- the inverse: every rule can actually be satisfied ---------------------------


def test_the_clean_app_is_clean(clean):
    """Zero violations. Not "few" — zero."""
    assert clean.checked is True
    assert clean.violations == [], [v.fingerprint_key for v in clean.violations]


@pytest.mark.parametrize("rule", R.ALL_RULES, ids=lambda r: r.id)
def test_no_rule_fires_on_correct_code(clean, rule):
    """A rule that cannot be satisfied is a rule that gets disabled."""
    assert rule.id not in rule_ids(clean)


# --- defect vs debt --------------------------------------------------------------


def test_defects_are_marked_never_baseline(broken):
    """The five guaranteed-broken rules must carry the flag onto every violation.

    The engine reads `neverBaseline` off the VIOLATION, never from a hardcoded list
    — rules belong to the provider. If the flag failed to propagate, a defect would
    become silently baselineable, and a 500-on-every-read would be grandfathered
    into permanence.
    """
    defect_ids = {r.id for r in R.defects()}
    for v in broken.violations:
        expected = v.rule_id in defect_ids
        assert v.never_baseline is expected, f"{v.rule_id} carries never_baseline={v.never_baseline}"


def test_the_defect_set_is_what_we_think_it_is():
    """Pin the defect list. Moving a rule across this line is a decision, not a typo.

    Note `update-has-create-default` is here despite returning 200, not 500: it
    silently destroys stored user data on every save, which is worse than a crash,
    because a crash is loud. The predicate is "broken right now", not "returns 5xx".
    """
    assert {r.id for r in R.defects()} == {
        "contract/reserved-metadata-unaliased",
        "contract/update-has-create-default",
        "contract/response-type-mismatch",
        "contract/response-inherits-write-validator",
        "contract/duplicate-schema-class-drifted",
        "contract/exception-without-reason",
        "contract/stale-exception",
        # A stale lockfile asserts an API you no longer serve, so the breaking-change
        # check downstream compares two identical stale files and cheerfully reports
        # no breakage. Baselining it would switch the guard off permanently while
        # leaving it green — the exact failure it exists to prevent.
        "contract/lockfile-stale",
        # A published spec that has stopped describing the implementation is worse
        # than no spec: clients are generated from it and agreements made on it, and
        # all of it is now fiction.
        "contract/spec-implementation-mismatch",
        # A stale generated client type is not a GAP — it is a lie the compiler is
        # currently believing. A renamed field reads as `undefined`, which renders as
        # nothing, which looks exactly like data that was never saved. That is how a
        # blank ZIP field survived a full release cycle in front of users.
        #
        # (Emitted by the Node adapter, catalogued here. tests/codegen-drift.test.js
        # pins the adapter's flag to this entry so the two cannot drift apart.)
        "contract/codegen-stale",
    }


def test_a_MISSING_lockfile_is_debt_so_the_tool_can_be_adopted():
    """Every code-first project on earth starts without a lockfile.

    If "you have no lockfile" could not be grandfathered, nobody could install this
    without first materializing — and a linter you must repair your repo to install is
    a linter nobody installs.
    """
    assert R.LOCKFILE_MISSING.never_baseline is False


def test_every_rule_cites_the_bug_it_stands_on():
    """A rule whose reason is written down is a rule nobody deletes in a hurry."""
    for rule in R.ALL_RULES:
        assert len(rule.incident) > 40, f"{rule.id} has no real incident text"


# --- determinism -----------------------------------------------------------------


def test_two_runs_produce_identical_output():
    """Set iteration is unordered. Unstable output means every run looks like a change."""
    from .conftest import run

    a = run("brokenapp", app="brokenapp.main:app")
    b = run("brokenapp", app="brokenapp.main:app")

    assert [v.to_json() for v in a.violations] == [v.to_json() for v in b.violations]
