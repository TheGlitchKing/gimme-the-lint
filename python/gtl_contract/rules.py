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
    "A lie left behind by a deletion. Found twice on the first real codebase: "
    "`Deal.user_id` and `Property.user_id` were declared server-managed years after "
    "the columns were removed. Not cosmetic — a dead declaration is a LIVE "
    "EXEMPTION. The day someone re-adds a `user_id` column it arrives pre-exempted "
    "from the contract and the guard stays quiet. It keeps a dead name alive and "
    "quietly loosens the ratchet.",
    never_baseline=True,
)

# --- the API contract lockfile ---------------------------------------------------

LOCKFILE_MISSING = _r(
    "contract/lockfile-missing",
    "A code-first API with no materialized contract.",
    "FastAPI computes an OpenAPI document from your schemas and serves it at "
    "/openapi.json. It is complete, it is correct, and it is invisible to every tool "
    "that reads files — so nothing stops a field rename from silently breaking every "
    "client of that endpoint. There is no artifact to diff, so there is no diff, so "
    "there is no warning. Write it down and it becomes a reviewable line in a PR "
    "instead of a 4am page.",
)

LOCKFILE_STALE = _r(
    "contract/lockfile-stale",
    "The committed API contract no longer matches the code.",
    "The inert-guard case, and the reason the lockfile is trustworthy at all. Change "
    "a schema without regenerating, and the lockfile goes on asserting an API you no "
    "longer serve — so the breaking-change check downstream compares two identical "
    "stale files and cheerfully reports no breakage. The guard goes inert and still "
    "shows green. This is `npm ci` refusing a stale package-lock.json, for exactly "
    "the same reason.",
    never_baseline=True,
)

ROUTE_WITHOUT_RESPONSE_MODEL = _r(
    "openapi/route-without-response-model",
    "A route that declares no response_model, so its response schema is EMPTY.",
    "65 of 244 routes on the first real codebase. FastAPI cannot infer a response schema "
    "from a function that does not declare one, so it emits an empty one — and the spec "
    "then lies by omission for 27% of the API. Everything downstream inherits the lie: a "
    "code generator has nothing to work from and types the whole endpoint `any`, so the "
    "generated client compiles happily against a shape nobody has ever checked. "
    "A perfect lockfile over an incomplete spec is a perfect record of a lie.",
)

UNSTABLE_OPERATION_ID = _r(
    "openapi/unstable-operation-id",
    "A route relying on FastAPI's auto-derived operationId.",
    "244 of 244 routes on the first real codebase. FastAPI derives operationId from the "
    "function name, the path and the method — so RENAMING A PYTHON HANDLER silently "
    "renames every generated client method that calls it. A pure refactor, touching no "
    "API surface, ships as a breaking change to every consumer. "
    "Set generate_unique_id_function to a form keyed on the METHOD AND PATH, which is "
    "unique by construction and is the only shape that actually survives a rename. "
    "Through 2.8.2 this rule recommended `lambda route: route.name` instead, and that "
    "was wrong twice: route.name IS the function name (starlette get_name returns "
    "__name__), so it silenced the rule without decoupling anything — and it collides on "
    "router factories, 15 routes onto 5 ids on the reporting codebase (#14).",
)

DUPLICATE_OPERATION_ID = _r(
    "openapi/duplicate-operation-id",
    "Two or more operations claiming the same operationId.",
    "The rule above, held to its own standard. A duplicate operationId makes the document "
    "INVALID, and a code generator then collides or silently drops all but one — so a "
    "client compiles fine against an endpoint it can no longer call, which is the exact "
    "harm unstable-operation-id exists to prevent. It went unchecked until 2.9.0: the "
    "reporter hit 15 routes sharing 5 ids and had to write their own test to find it, "
    "because our recommended fix caused it. FastAPI's default generator includes the path "
    "and never collides, so a duplicate is almost always the fingerprint of a custom "
    "generate_unique_id_function that is not, in fact, unique. FastAPI does warn — once "
    "per duplicate, into startup output nobody reads.",
)

# --- generated client types ------------------------------------------------------
#
# These two are EMITTED by the Node adapter (lib/adapters/codegen-drift.js), not by this
# package — codegen-drift reads a committed JSON file and runs a JS generator, and never
# imports the app.
#
# They are catalogued HERE anyway, and that is deliberate. `gtl-contract rules` is the
# documented answer to "why does this rule exist?" — the thing a person reads before
# disabling a rule that just blocked their push. A catalogue that omits two rules is a
# catalogue that sends that person away empty-handed, and they will disable the rule on a
# guess.
#
# tests/codegen-drift.test.js pins the adapter's `neverBaseline` to these entries, so the
# two cannot drift apart. (They already did once, in the other direction: openapi.js
# inferred the flag by rule-id exclusion and silently promoted two debt rules to defects.)

CODEGEN_STALE = _r(
    "contract/codegen-stale",
    "The committed client types no longer match the API they are typed against.",
    "A component read `prospect.zip`; the API returns `zip_code`. The backend was correct, "
    "the contract check was green, the lockfile was fresh, the database row was right — and "
    "the user saw a BLANK ZIP FIELD for a full release cycle, because `undefined` renders "
    "as nothing, and nothing looks exactly like data that was never saved. "
    "A stale generated type is not a gap. It is a lie the compiler is currently believing.",
    never_baseline=True,
)

CODEGEN_MISSING = _r(
    "contract/codegen-missing",
    "A generator is configured for the client types, but the output has never been written.",
    "Debt on purpose: every repo starts without generated types, and a check you must "
    "repair your repo to install is a check nobody installs. Until it is written, the "
    "frontend is typed by hand against an API it cannot see — which is how a hand-written "
    "`TaskFormData` came to declare `estimated_hours`, a field that has never existed, one "
    "word away from the real `estimated_cost`.",
)

SPEC_IMPLEMENTATION_MISMATCH = _r(
    "contract/spec-implementation-mismatch",
    "A hand-authored API spec that no longer describes what the code serves.",
    "The declared-vs-actual problem, one level up from the database. A spec that has "
    "quietly stopped matching the implementation is worse than no spec: clients are "
    "generated from it, contracts are negotiated on it, and all of it is now fiction. "
    "Neither file is overwritten — a hand-authored spec is the source of truth and is "
    "never ours to rewrite — so the disagreement is reported and a human decides "
    "which side is wrong.",
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
    LOCKFILE_MISSING,
    LOCKFILE_STALE,
    SPEC_IMPLEMENTATION_MISMATCH,
    ROUTE_WITHOUT_RESPONSE_MODEL,
    UNSTABLE_OPERATION_ID,
    DUPLICATE_OPERATION_ID,
    CODEGEN_STALE,
    CODEGEN_MISSING,
)

BY_ID: dict[str, Rule] = {r.id: r for r in ALL_RULES}


def defects() -> tuple[Rule, ...]:
    return tuple(r for r in ALL_RULES if r.never_baseline)


def debt() -> tuple[Rule, ...]:
    return tuple(r for r in ALL_RULES if not r.never_baseline)
