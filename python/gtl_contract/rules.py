"""The rule registry — and the defect/debt decision, in one place.

Every rule here exists because of a specific production bug. The `incident` field
is not decoration: a rule whose reason is written down is a rule nobody deletes in
a hurry, and "why does this fire?" is the first question anyone asks when a check
blocks their push.

## never_baseline: the one place this tool stops being progressive

gimme-the-lint's whole thesis is that existing violations get grandfathered and
only NEW ones block. That is right for debt. It is wrong for a defect.

The predicate is NOT "does it return a 500". `update-has-create-default` returns a
cheerful 200 while overwriting stored user data on every save — worse than a 500,
because a 500 is loud. The actual test is:

    Is the app broken RIGHT NOW — or certain to break — for everyone,
    regardless of what anyone does next?

If yes, it is a defect, and a defect may never be silently grandfathered. There is
still an escape hatch: a defect can be EXCEPTED in `.gtl/config.js`, which requires
a human to write down a reason. Nobody is going to type "we accept that GET
/conversations returns 500 for every user." That friction is the feature.

The precedent already exists in this product: gitleaks findings are never
baselined, because a leaked secret is not technical debt.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Rule:
    id: str
    summary: str
    #: Why this rule exists — the bug it is standing on.
    incident: str
    #: True when the finding means "already broken", not "not yet ideal".
    never_baseline: bool = False


def _r(id: str, summary: str, incident: str, never_baseline: bool = False) -> Rule:
    return Rule(id=id, summary=summary, incident=incident, never_baseline=never_baseline)


# --- DEBT: a gap, not a break. Baselineable. ------------------------------------
#
# These describe an application that works today but has a hole in it. Grandfathering
# them is exactly what progressive linting is for: the existing hole stays, a NEW
# hole blocks. A team adopting this tool on a large codebase will have hundreds, and
# demanding they all be fixed before the first commit is how linters get uninstalled.

COLUMN_NOT_WRITABLE = _r(
    "contract/column-not-writable",
    "A column exists that no write schema accepts, so a client can never save it.",
    "#974: a user filled in twelve fields on the property form and four were "
    "persisted. PropertyCreate declared 17 of 37 columns; extra='ignore' dropped "
    "the rest and the API returned 201. Silent data loss, confirmed as success.",
)

COLUMN_NOT_READABLE = _r(
    "contract/column-not-readable",
    "A column the response schema never returns, so no client can read it.",
    "ProjectEvent.phase_id was a real, indexed foreign key that no standalone "
    "schema exposed — you could not set an event's phase, change it, or even read "
    "which phase it was in.",
)

CREATE_UPDATE_DISAGREE = _r(
    "contract/create-update-disagree",
    "A field exists on create but not update (or vice versa) without being declared.",
    "#974: the Deal schemas each omitted 17-19 columns — every buy-and-hold "
    "operating expense. Zero deals in the database had ever persisted one.",
)

WRITE_SCHEMA_NOT_STRICT = _r(
    "contract/write-schema-not-strict",
    "A write schema does not forbid unknown keys, so a typo is silently discarded.",
    "This is the MECHANISM behind every other rule here. With extra='ignore', a "
    "renamed or misspelled field is accepted, dropped, and confirmed with a 201. "
    "Load-bearing debt: while it is unfixed, the other rules are advisory.",
)

UNREGISTERED_WRITE_SURFACE = _r(
    "contract/unregistered-write-surface",
    "A model a client can write to, with no contract covering it.",
    "#1003: four entities nobody knew were entities. Their schemas lived in "
    "routers rather than schemas/, so a scan of the obvious place missed them "
    "entirely — a blind spot invisible to itself.",
)

DUPLICATE_SCHEMA_CLASS = _r(
    "contract/duplicate-schema-class",
    "The same schema class name defined in two modules, with identical fields.",
    "Harmless twins today, drift tomorrow. Nobody writes this on purpose; it "
    "happens because two people each needed a response shape and neither knew the "
    "other existed.",
)

UNIMPORTABLE_MODULE = _r(
    "contract/unimportable-module",
    "A module in the models/schemas package cannot be imported.",
    "Found on the very first run against a real codebase: app/models/folder.py was "
    "a backward-compat shim re-exporting a `Folder` model that had been renamed away "
    "years earlier. Nothing imported it, so it rotted in silence — and would have "
    "exploded the instant anyone touched it. "
    "It matters here for a second reason: whatever models live in a module we cannot "
    "import are INVISIBLE to this checker. Their contract goes unchecked, and without "
    "this rule it would go unchecked SILENTLY. The blind spot gets a name.",
)


# --- DEFECT: broken now, or certain to break. NEVER baselineable. ---------------

RESERVED_METADATA_UNALIASED = _r(
    "contract/reserved-metadata-unaliased",
    "A response field named `metadata` with no alias onto a real column.",
    "#998A: `metadata` is RESERVED on every SQLAlchemy model — Base.metadata is "
    "the MetaData registry. ConversationResponse.metadata had no alias, so reading "
    "any conversation returned the registry object instead of a dict: a 500 on GET "
    "and PUT, for every conversation, forever.",
    never_baseline=True,
)

UPDATE_HAS_CREATE_DEFAULT = _r(
    "contract/update-has-create-default",
    "An update schema carries a non-None default, which overwrites stored data.",
    "#998B: BudgetLineItemUpdateNested had `status = \"pending\"` and `notes = None`. "
    "An update schema is applied OVER an existing row, so a field the client did "
    "not send materialized as its default and overwrote what the user had stored. "
    "Opening a project and clicking Save reset every approved line item to pending "
    "and wiped its notes. The user changed nothing. Returns 200 — which is why this "
    "is a defect and not merely a 500: a 500 is loud, and this was silent.",
    never_baseline=True,
)

RESPONSE_TYPE_MISMATCH = _r(
    "contract/response-type-mismatch",
    "A response field's type contradicts its column's type.",
    "#974: PropertyResponse.units_details was typed `str` against a JSON column. "
    "Harmless right up until someone wrote CORRECT data into it, at which point "
    "every GET raised ResponseValidationError and the entire Portfolio page 500'd. "
    "A landmine with a fuse — and baselining it would suppress the only warning you "
    "get before it detonates.",
    never_baseline=True,
)

RESPONSE_INHERITS_WRITE_VALIDATOR = _r(
    "contract/response-inherits-write-validator",
    "A write-side validator inherited onto a response schema, so it runs on reads.",
    "The read path must never reject data the database already contains. A "
    "validator on a shared base runs on every READ, so one legacy row with an "
    "unexpected value 500s the endpoint returning it.",
    never_baseline=True,
)

DUPLICATE_SCHEMA_CLASS_DRIFTED = _r(
    "contract/duplicate-schema-class-drifted",
    "The same schema class name in two modules, with DIFFERENT fields.",
    "DocumentResponse existed in both app/routers/documents.py and "
    "app/schemas/deal.py with different fields — so which document shape a client "
    "got depended on which endpoint it happened to hit. Not a gap: an application "
    "that is already lying to somebody.",
    never_baseline=True,
)

EXCEPTION_WITHOUT_REASON = _r(
    "contract/exception-without-reason",
    "A declared exception with no reason, or a reason that says nothing.",
    "An unexplained omission is indistinguishable from the bug. The reason is how "
    "tacit knowledge ('why can't you change an event's type?') gets written down "
    "instead of living in one person's head until they leave. Baselining this rule "
    "would defeat it entirely.",
    never_baseline=True,
)

STALE_EXCEPTION = _r(
    "contract/stale-exception",
    "An exception naming a model or column that no longer exists.",
    "A lie left behind by a deletion. It keeps a dead name alive and quietly "
    "loosens the ratchet.",
    never_baseline=True,
)


ALL_RULES: tuple[Rule, ...] = (
    COLUMN_NOT_WRITABLE,
    COLUMN_NOT_READABLE,
    CREATE_UPDATE_DISAGREE,
    WRITE_SCHEMA_NOT_STRICT,
    UNREGISTERED_WRITE_SURFACE,
    DUPLICATE_SCHEMA_CLASS,
    UNIMPORTABLE_MODULE,
    RESERVED_METADATA_UNALIASED,
    UPDATE_HAS_CREATE_DEFAULT,
    RESPONSE_TYPE_MISMATCH,
    RESPONSE_INHERITS_WRITE_VALIDATOR,
    DUPLICATE_SCHEMA_CLASS_DRIFTED,
    EXCEPTION_WITHOUT_REASON,
    STALE_EXCEPTION,
)

BY_ID: dict[str, Rule] = {r.id: r for r in ALL_RULES}


def defects() -> tuple[Rule, ...]:
    return tuple(r for r in ALL_RULES if r.never_baseline)


def debt() -> tuple[Rule, ...]:
    return tuple(r for r in ALL_RULES if not r.never_baseline)
