"""`column-not-writable` on a tenancy column points at the dangerous fix.

#16. A reporter's `org_id` — their tenant-isolation boundary, correctly absent from
every write schema — was flagged `contract/column-not-writable`. The message said:

    Add it to the write schema, or declare it in serverManaged / intentionallyAbsent.

The obvious reading is the first clause, and following it produces a write schema in
which **a client sets its own tenant**. That is cross-tenant write access, arrived at by
doing what the tool said. An agent following the LLM footer would open the hole or bury
the finding, and report success either way.

The rule is RIGHT that the column is not client-writable. It simply cannot tell
"correctly locked down" from "accidentally omitted" — and its wording pointed at the
dangerous reading of the two.

The finding still fires. Only the ORDER and the framing change: when the column name says
the stakes are cross-tenant writes, the safe reading goes first.

## Why this lives in the provider

The firewall (principle 3) is explicit: *"when engine code starts knowing what `org_id`
means, the firewall has been breached — the fix belongs in a provider, every time."*
This is a provider, so this is where it belongs.

The reporter also asked for `org_id`/`user_id`/`owner_id` in core's
`DEFAULT_SERVER_MANAGED`. That is the other side of the line and it is declined:
`DEFAULT_SERVER_MANAGED` **suppresses** findings, so shipping `user_id` in it would hide
every genuinely-forgotten `user_id` — which is this rule's entire job. Warning is safe.
Suppressing on a guess is not.
"""

from __future__ import annotations

from gtl_contract import rules as R
from gtl_contract.config import DEFAULT_SERVER_MANAGED
from gtl_contract.providers.sqlalchemy_pydantic.checks import (
    looks_like_a_tenancy_boundary,
)


def violation(result, key):
    return next(v for v in result.violations if v.fingerprint_key == key)


def test_the_tenancy_column_still_FIRES(broken):
    """The finding is correct and must not be silenced.

    The tool cannot know this `org_id` is deliberate. Suppressing it on a name would
    hide the case where it was genuinely forgotten.
    """
    keys = [v.fingerprint_key for v in broken.violations if v.rule_id == R.COLUMN_NOT_WRITABLE.id]

    assert "BudgetLineItem.org_id:writable" in keys


def test_it_does_NOT_lead_with_add_it_to_the_write_schema(broken):
    """The exact trap in #16.

    "Add it to the write schema" is the first thing the old message said, and doing it
    hands the client its own tenant id.
    """
    message = violation(broken, "BudgetLineItem.org_id:writable").message

    assert "Do NOT add it to a write schema" in message
    # Order matters as much as content: the safe reading has to arrive before the
    # "unless it really is client-supplied" caveat, or the caveat is what gets acted on.
    assert message.index("THIS FINDING IS CORRECT") < message.index("Only if")


def test_it_names_the_consequence_not_just_the_remedy(broken):
    """"Declare it serverManaged" alone is an instruction. It is not a reason.

    Principle 7: reasons are the product. Somebody about to add `org_id` to a write
    schema needs to read what happens next, not just be told not to.
    """
    message = violation(broken, "BudgetLineItem.org_id:writable").message

    assert "write into another tenant" in message
    assert "serverManaged" in message


def test_an_ORDINARY_column_keeps_the_ordinary_message(broken):
    """`operating_expenses` is #974 — genuinely dropped user data.

    For that column "add it to the write schema" is exactly right, and a security
    warning would be noise. Noise is what trains people to stop reading.
    """
    message = violation(broken, "Deal.operating_expenses:writable").message

    assert "silently dropped" in message
    assert "another tenant" not in message


def test_the_fingerprint_is_UNCHANGED_so_no_baseline_is_invalidated(broken):
    """Identity is `<Model>.<column>:writable` — the message is not part of it.

    Principle 6: every baseline in every consumer repo is keyed by these hashes.
    Rewording a message must never resurrect a grandfathered finding.
    """
    keys = {v.fingerprint_key for v in broken.violations if v.rule_id == R.COLUMN_NOT_WRITABLE.id}

    assert "BudgetLineItem.org_id:writable" in keys
    assert "Deal.operating_expenses:writable" in keys


# --- the heuristic itself ---------------------------------------------------------


def test_it_recognises_the_columns_the_reporter_listed():
    for column in ("org_id", "organization_id", "tenant_id", "account_id", "user_id",
                   "owner_id", "created_by"):
        assert looks_like_a_tenancy_boundary(column), column


def test_it_is_case_insensitive():
    assert looks_like_a_tenancy_boundary("Org_ID")


def test_it_does_NOT_match_ordinary_foreign_keys():
    """A `*_id` pattern would match all of these, and warning on them is worse than
    not warning at all: an ignored security warning is a disabled one."""
    for column in ("property_id", "invoice_id", "deal_id", "line_item_id", "amount"):
        assert not looks_like_a_tenancy_boundary(column), column


def test_core_defaults_are_NOT_extended_with_tenancy_columns():
    """The half of #16 that is declined, pinned so it is not quietly done later.

    `DEFAULT_SERVER_MANAGED` suppresses. Adding `user_id` to it would silently
    server-manage `user_id` on every table in every repo — and a genuinely forgotten
    `user_id` would stop being reported, which is the rule's whole job. It also lives in
    core `config.py`, the exact place principle 3 names.
    """
    assert DEFAULT_SERVER_MANAGED == frozenset({"created_at", "updated_at", "deleted_at"})
    assert not (DEFAULT_SERVER_MANAGED & {"org_id", "user_id", "owner_id", "tenant_id"})
