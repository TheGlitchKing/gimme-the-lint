"""The rules, applied to one entity at a time.

Each function takes a ModelRecord plus the authored config and yields Violations.
Nothing here knows about baselines, fingerprints, or git — that is the engine's
job. These just answer: does this model agree with the schemas that expose it?

Every rule's `fingerprint_key` names the SUBJECT, not the file and not the message:
`Deal.operating_expenses:writable`. That is what lets a finding survive its schema
being moved to another file, and stops a message that enumerates a changing set
("no write schema accepts [a, b]" -> "[a, b, c]") from re-reporting two known
problems as new every time a third appears.
"""

from __future__ import annotations

from typing import Any, Iterator

from ... import rules as R
from ...config import MIN_REASON_LENGTH, Config
from ...violation import Violation
from .inventory import ModelRecord

UPDATE_SUFFIXES = ("Update", "UpdateNested")


def _v(rule: R.Rule, key: str, message: str, file: str = "", **context: Any) -> Violation:
    return Violation(
        rule_id=rule.id,
        message=message,
        fingerprint_key=key,
        file=file or "",
        never_baseline=rule.never_baseline,
        context=context,
    )


def _unwrap_optional(annotation: Any) -> Any:
    """`Optional[X]` -> `X`; anything else unchanged."""
    from typing import Union, get_args, get_origin

    if get_origin(annotation) is Union:
        args = [a for a in get_args(annotation) if a is not type(None)]
        if len(args) == 1:
            return args[0]
    return annotation


def _is_json_column(col: Any) -> bool:
    from sqlalchemy import JSON
    from sqlalchemy.dialects.postgresql import JSONB

    return isinstance(col.type, (JSON, JSONB))


def _exposed_names(schema: Any) -> set[str]:
    """Field names on a schema, plus any validation aliases they carry.

    A response may legitimately expose a column under a different wire name
    (`meta_config` served as `metadata`). The alias IS the exposure, so a rule that
    only looked at field names would report a correctly-aliased column as missing.
    """
    names = set(schema.model_fields)
    for f in schema.model_fields.values():
        alias = getattr(f, "validation_alias", None)
        if alias:
            names.add(str(alias))
    return names


def _primary_keys(record: ModelRecord) -> set[str]:
    """Primary keys are server-managed BY DERIVATION, not by declaration.

    A surrogate key is generated, not supplied — if a client could set it, it could
    forge it. Making every entity declare its own primary key as `serverManaged`
    would be pure noise, one line per model, forever. And noise is not free: it is
    what trains people to stop reading the config, and then to stop declaring the
    exceptions that actually matter.

    (An application using client-supplied natural keys can still expose one: put it
    on the write schema and the rule is satisfied — this only suppresses the
    complaint about its ABSENCE.)
    """
    return {name for name, col in record.columns.items() if col.primary_key}


def _client_columns(record: ModelRecord, config: Config) -> set[str]:
    """Columns a client is supposed to be able to write."""
    override = config.override_for(record.name)
    return (
        set(record.columns)
        - _primary_keys(record)
        - config.server_managed
        - override.server_managed
        - set(override.intentionally_absent)
    )


# --- rule 1: every column is exposed somewhere ----------------------------------


def every_client_column_is_writable(record: ModelRecord, config: Config) -> Iterator[Violation]:
    """A column that no write schema declares can never be saved — silently, with a 201."""
    writable: set[str] = set()
    for schema in record.write_schemas.values():
        writable |= set(schema.model_fields)

    for column in sorted(_client_columns(record, config) - writable):
        yield _v(
            R.COLUMN_NOT_WRITABLE,
            f"{record.name}.{column}:writable",
            f"No write schema for {record.name} accepts `{column}`. A client that sends it "
            f"gets a 201 and the value is silently dropped. Add it to the write schema, or "
            f"declare it in serverManaged / intentionallyAbsent with a reason.",
            file=record.schema_module or "",
            model=record.name,
            column=column,
        )


def every_column_is_readable(record: ModelRecord, config: Config) -> Iterator[Violation]:
    """A column the response never returns is invisible to every client."""
    response = record.schema("Response")
    if response is None:
        return

    override = config.override_for(record.name)
    exposed = _exposed_names(response)

    missing = (
        set(record.columns)
        - exposed
        - config.server_managed
        - override.server_managed
        - set(override.intentionally_absent)
    )

    for column in sorted(missing):
        yield _v(
            R.COLUMN_NOT_READABLE,
            f"{record.name}.{column}:readable",
            f"{record.name}Response does not return `{column}` — no client can ever read it. "
            f"If that is deliberate, declare it in serverManaged or intentionallyAbsent.",
            file=record.schema_module or "",
            model=record.name,
            column=column,
        )


# --- rule 2: create / update / response agree -----------------------------------


def create_and_update_agree(record: ModelRecord, config: Config) -> Iterator[Violation]:
    """A field you can set but never change (or vice versa) is drift, unless declared."""
    create = record.schema("Create")
    update = record.schema("Update")
    # No update schema at all is a legitimate design (an immutable entity), not an
    # omission. Absence of a thing is only a bug when the thing was expected.
    if create is None or update is None:
        return

    override = config.override_for(record.name)
    create_fields = set(create.model_fields)
    update_fields = set(update.model_fields)

    for field in sorted(create_fields - update_fields - set(override.intentionally_absent)):
        yield _v(
            R.CREATE_UPDATE_DISAGREE,
            f"{record.name}.{field}:create-only",
            f"{record.name}: `{field}` can be set on create but never changed. If that is "
            f"deliberate (an immutable field), say so in intentionallyAbsent with a reason.",
            file=record.schema_module or "",
            model=record.name,
            field=field,
        )

    for field in sorted(update_fields - create_fields - set(override.non_column_fields)):
        yield _v(
            R.CREATE_UPDATE_DISAGREE,
            f"{record.name}.{field}:update-only",
            f"{record.name}: `{field}` can be changed but never set on create.",
            file=record.schema_module or "",
            model=record.name,
            field=field,
        )


# --- rule 3: no create-time defaults on an update schema (DEFECT) ---------------


def no_create_time_defaults_on_update(record: ModelRecord, config: Config) -> Iterator[Violation]:
    """An update schema is applied OVER an existing row.

    A field with a non-None default that the client did not send materializes as
    that default and overwrites whatever the user had stored. `None` defaults are
    fine — `exclude_unset` distinguishes "not sent" from "explicitly null", so an
    untouched field is never written. It is the NON-None defaults that are loaded
    guns.
    """
    from pydantic_core import PydanticUndefined

    for name, schema in record.write_schemas.items():
        if not name.endswith(UPDATE_SUFFIXES):
            continue
        for field_name, f in schema.model_fields.items():
            if f.is_required():
                continue
            if f.default is None or f.default is PydanticUndefined:
                continue
            yield _v(
                R.UPDATE_HAS_CREATE_DEFAULT,
                f"{record.name}.{name}.{field_name}:update-default",
                f"{name}.{field_name} carries the create-time default {f.default!r}. An update "
                f"schema is applied over a stored row, so when the client omits this field the "
                f"default is written OVER the user's data. Returns 200 while destroying it. "
                f"Defaults belong on the Create schema only.",
                file=record.schema_module or "",
                model=record.name,
                schema=name,
                field=field_name,
            )


# --- rule 4: the reserved-name bridge (DEFECT) ----------------------------------


def metadata_must_be_aliased(record: ModelRecord, config: Config) -> Iterator[Violation]:
    """`metadata` is RESERVED on every SQLAlchemy declarative model.

    `Base.metadata` is the MetaData registry, and `hasattr(Model, "metadata")` is
    therefore always True. A response field called `metadata` with `from_attributes`
    reads the REGISTRY, not a column, and blows up. So it MUST carry a
    validation_alias pointing at a real column.
    """
    response = record.schema("Response")
    if response is None or "metadata" not in response.model_fields:
        return

    key = f"{record.name}.metadata:reserved"
    file = record.schema_module or ""
    field = response.model_fields["metadata"]
    alias = getattr(field, "validation_alias", None)

    if not alias:
        yield _v(
            R.RESERVED_METADATA_UNALIASED,
            key,
            f"{record.name}Response.metadata has no validation_alias. `metadata` is reserved on "
            f"the ORM model, so from_attributes reads SQLAlchemy's MetaData registry instead of "
            f"a column: a 500 on every read of this entity, forever. Alias it onto the real "
            f"column.",
            file=file,
            model=record.name,
        )
        return

    alias_name = str(alias)
    if alias_name == "metadata":
        yield _v(
            R.RESERVED_METADATA_UNALIASED,
            key,
            f"{record.name}Response.metadata aliases `metadata`, which is the reserved name "
            f"itself. The column cannot be called that.",
            file=file,
            model=record.name,
        )
    elif alias_name not in record.columns:
        yield _v(
            R.RESERVED_METADATA_UNALIASED,
            key,
            f"{record.name}Response.metadata aliases `{alias_name}`, which is not a column on "
            f"{record.name}.",
            file=file,
            model=record.name,
        )


# --- rule 5: response types match column types (DEFECT) -------------------------


def response_types_match_columns(record: ModelRecord, config: Config) -> Iterator[Violation]:
    """A JSON column typed `str` in the response is a landmine with a fuse.

    Harmless right up until someone writes CORRECT data into it — at which point
    every read raises a validation error and 500s the endpoint.
    """
    response = record.schema("Response")
    if response is None:
        return

    for column_name, column in record.columns.items():
        if not _is_json_column(column):
            continue
        field = response.model_fields.get(column_name)
        if field is None:
            continue
        # Compare TYPES, not the repr: `Optional[List[Dict[str, Any]]]` CONTAINS
        # the substring "str", so a naive text check flags the correct type as the
        # broken one.
        if _unwrap_optional(field.annotation) is str:
            yield _v(
                R.RESPONSE_TYPE_MISMATCH,
                f"{record.name}.{column_name}:response-type",
                f"{record.name}Response.{column_name} is typed `str`, but the column is JSON. "
                f"The first correct value written to it will 500 every read of this entity.",
                file=record.schema_module or "",
                model=record.name,
                column=column_name,
            )


# --- rule 6: write schemas are strict -------------------------------------------


def write_schemas_forbid_unknown_keys(record: ModelRecord, config: Config) -> Iterator[Violation]:
    """An unknown key must be a loud 422, never a silent no-op.

    With `extra='ignore'`, a typo'd or renamed field is accepted, discarded, and
    confirmed with a 201. That is the mechanism behind every other rule in this file
    — which is why this one is load-bearing debt: until it is fixed, the others are
    advisory.
    """
    for name, schema in record.write_schemas.items():
        if schema.model_config.get("extra") == "forbid":
            continue
        yield _v(
            R.WRITE_SCHEMA_NOT_STRICT,
            f"{record.name}.{name}:strict",
            f"{name} does not set extra='forbid'. An unknown key — a typo, a renamed field — "
            f"is silently dropped and the request still succeeds. This is the mechanism behind "
            f"every other contract bug.",
            file=record.schema_module or "",
            model=record.name,
            schema=name,
        )


# --- rule 7: no write-side validator leaks onto the response (DEFECT) -----------


def response_does_not_inherit_write_validators(
    record: ModelRecord, config: Config
) -> Iterator[Violation]:
    """A validator on a shared base runs on every READ.

    One legacy row with an unexpected value then 500s the endpoint returning it. The
    read path must never reject data the database already contains.
    """
    response = record.schema("Response")
    if response is None:
        return

    decorators = getattr(response, "__pydantic_decorators__", None)
    if decorators is None:
        return

    names = list(decorators.field_validators) + list(decorators.model_validators)
    # Response-side coercion is legitimate; it is the write-side coercers we hunt.
    offenders = sorted(n for n in names if n.startswith(("_coerce", "_validate")))

    for offender in offenders:
        yield _v(
            R.RESPONSE_INHERITS_WRITE_VALIDATOR,
            f"{record.name}.{offender}:read-validator",
            f"{record.name}Response inherits the write-side validator `{offender}`. It runs on "
            f"every read, so a single legacy row the database already contains can 500 the "
            f"endpoint. Write validators belong on the write-only subclass.",
            file=record.schema_module or "",
            model=record.name,
            validator=offender,
        )


ENTITY_CHECKS = (
    every_client_column_is_writable,
    every_column_is_readable,
    create_and_update_agree,
    no_create_time_defaults_on_update,
    metadata_must_be_aliased,
    response_types_match_columns,
    write_schemas_forbid_unknown_keys,
    response_does_not_inherit_write_validators,
)


# --- registry-level rules: the backstops ----------------------------------------


def classified_models_are_honest(
    records: list[ModelRecord], config: Config
) -> Iterator[Violation]:
    """`triage` and `telemetry` are not a way to make the contract go away.

    A classified model must be a DELIBERATE exception: the kind must be real, and
    the reason has to say something. Without this, the cheapest way to silence the
    checker is to declare the problem out of existence.
    """
    known = {r.name for r in records}

    for name, (kind, reason) in sorted(config.classifications.items()):
        if name not in known:
            yield _v(
                R.STALE_EXCEPTION,
                f"{name}:classification",
                f"`{name}` is classified `{kind}` but no such model exists. A classification for "
                f"a model that is gone is a lie left behind by a deletion.",
                model=name,
            )
            continue

        from ...config import CLASSIFICATION_KINDS

        if kind not in CLASSIFICATION_KINDS:
            yield _v(
                R.EXCEPTION_WITHOUT_REASON,
                f"{name}:classification-kind",
                f"`{name}` has the unknown classification kind {kind!r}. Use one of: "
                f"{', '.join(sorted(CLASSIFICATION_KINDS))}.",
                model=name,
            )
        if not reason or len(reason.strip()) < MIN_REASON_LENGTH:
            yield _v(
                R.EXCEPTION_WITHOUT_REASON,
                f"{name}:classification-reason",
                f"`{name}` is classified {kind!r} with no real reason given. Say WHY the "
                f"contract does not apply, or bring it under contract. An unexplained omission "
                f"is indistinguishable from the bug.",
                model=name,
            )


def exceptions_have_reasons(records: list[ModelRecord], config: Config) -> Iterator[Violation]:
    """Every declared exception must justify itself, and name something real."""
    known = {r.name: r for r in records}

    for model_name, override in sorted(config.entities.items()):
        record = known.get(model_name)
        if record is None:
            yield _v(
                R.STALE_EXCEPTION,
                f"{model_name}:entity-override",
                f"`.gtl/config.js` declares exceptions for `{model_name}`, which is not a model. "
                f"Left behind by a rename or a deletion.",
                model=model_name,
            )
            continue

        declared = {**override.intentionally_absent, **override.non_column_fields}
        for field_name, reason in sorted(declared.items()):
            if not reason or len(str(reason).strip()) < MIN_REASON_LENGTH:
                yield _v(
                    R.EXCEPTION_WITHOUT_REASON,
                    f"{model_name}.{field_name}:reason",
                    f"{model_name}.{field_name} is declared as an exception with no real reason. "
                    f"Say WHY, or the next person will 'fix' it.",
                    model=model_name,
                    field=field_name,
                )

        for column in sorted(override.server_managed):
            if column not in record.columns:
                yield _v(
                    R.STALE_EXCEPTION,
                    f"{model_name}.{column}:stale-server-managed",
                    f"{model_name}.{column} is declared serverManaged, but there is no such "
                    f"column. A stale exception quietly loosens the ratchet.",
                    model=model_name,
                    column=column,
                )

        for column in sorted(override.intentionally_absent):
            if column not in record.columns:
                yield _v(
                    R.STALE_EXCEPTION,
                    f"{model_name}.{column}:stale-absent",
                    f"{model_name}.{column} is declared intentionallyAbsent, but there is no "
                    f"such column.",
                    model=model_name,
                    column=column,
                )


def unimportable_modules(failures: list, config: Config) -> Iterator[Violation]:
    """A module we could not import — and therefore a set of models we could not check.

    Two things are wrong at once, and the second is the one that matters here:

    1. The module itself is broken. Whatever is in it will explode the moment anyone
       imports it. (The first real codebase this ran against had a dead
       backward-compat shim re-exporting a class renamed away years earlier.)

    2. Its models are INVISIBLE to this checker. Their contract goes unchecked — and
       without this violation it would go unchecked in silence, which is the one
       thing this tool must never do.

    Debt, not a defect: a mature codebase may well have one of these, and refusing to
    run until it is fixed would recreate the "linter finds a thousand problems on day
    one" disease. But it is LOUD, and it says exactly what went unseen.
    """
    for failure in failures:
        yield _v(
            R.UNIMPORTABLE_MODULE,
            f"{failure.module}:unimportable",
            f"`{failure.module}` cannot be imported ({failure.error}). Any models or schemas "
            f"defined in it are INVISIBLE to the contract check — they are not clean, they are "
            f"unchecked. Fix the module, or delete it if it is dead.",
            file=failure.module.replace(".", "/") + ".py",
            module=failure.module,
        )


def duplicate_schema_classes(dupes: list[dict], config: Config) -> Iterator[Violation]:
    """Two definitions of one name. If their fields differ, the app is already lying."""
    for dupe in dupes:
        name = dupe["name"]
        where = " and ".join(dupe["modules"])
        if dupe["drifted"]:
            yield _v(
                R.DUPLICATE_SCHEMA_CLASS_DRIFTED,
                f"{name}:duplicate-drifted",
                f"`{name}` is defined in {where} with DIFFERENT fields. Which shape a client "
                f"gets depends on which endpoint it happens to hit — the application is already "
                f"lying to somebody.",
                file=dupe["modules"][0],
                schema=name,
            )
        else:
            yield _v(
                R.DUPLICATE_SCHEMA_CLASS,
                f"{name}:duplicate",
                f"`{name}` is defined in {where}. Identical today; the moment one is edited, "
                f"which shape a client gets depends on which endpoint it hits.",
                file=dupe["modules"][0],
                schema=name,
            )


def unaudited_request_bodies(
    bodies: dict[str, list[str]],
    records: list[ModelRecord],
    config: Config,
) -> Iterator[Violation]:
    """A request body covered by no entity contract.

    Found by reading the ROUTE TABLE, not by matching names — because the writers
    that do not follow the naming convention are exactly the ones a name-based scan
    cannot see, and exactly the ones nobody has audited.

    Today's unaudited bodies are pinned in config. The pin is a RATCHET: a NEW
    unrecognized body fails until somebody looks at it once. This does not claim to
    know which table each one writes; that audit is real work, and it is filed
    rather than guessed at.
    """
    covered: set[str] = set()
    for record in records:
        covered |= set(record.schema_classes)

    for name in sorted(set(bodies) - covered - config.unaudited_request_bodies):
        routes = ", ".join(bodies[name][:3])
        yield _v(
            R.UNREGISTERED_WRITE_SURFACE,
            f"{name}:request-body",
            f"`{name}` is accepted as a request body ({routes}) but is covered by no entity "
            f"contract. If it writes a table, give that model real Create/Update schemas. If it "
            f"writes no table (a calculator input, an auth flow, a search query), pin it in "
            f"unauditedRequestBodies.",
            schema=name,
        )


def unregistered_models(records: list[ModelRecord], config: Config) -> Iterator[Violation]:
    """A model with a client write surface that is neither checked nor classified.

    In practice a model WITH write schemas is checked by ENTITY_CHECKS, so this fires
    for the inverse case the classifications exist to cover: a model that a client
    can write to via a non-conventional body. Those surface through
    `unaudited_request_bodies`. What remains here is the honest bookkeeping: a
    classification must correspond to a model that actually has a write surface,
    otherwise it is noise pretending to be diligence.
    """
    by_name = {r.name: r for r in records}
    for name, (kind, _reason) in sorted(config.classifications.items()):
        record = by_name.get(name)
        if record is None:
            continue  # reported as a stale exception elsewhere
        if not record.has_write_surface:
            yield _v(
                R.STALE_EXCEPTION,
                f"{name}:needless-classification",
                f"`{name}` is classified `{kind}`, but it has no client write surface — nothing "
                f"can drift, so it needed no classification. Remove it; a needless exception "
                f"trains people to add more.",
                model=name,
            )
