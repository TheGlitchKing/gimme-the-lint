"""Every model, and what kind of thing it is.

## Why this is spined on the ORM registry and not on the schemas

The obvious way to build this inventory is to start from the Pydantic schemas and
discover the models behind them. That works right up until the interesting case: a
model with **no schemas at all** is then structurally invisible — it cannot appear
in a list built by walking schemas.

Which is exactly how "entities nobody knew were entities" happens. An inventory
whose blind spot is the thing it exists to find is not an inventory.

So this walks the **mapper registry** — every mapped class, by construction — and
joins the schema information *onto* it. A new table shows up here whether or not
anyone wrote a schema for it, whether or not anyone remembered to register it, and
whether or not anyone wanted it to.

## The classification, and which part of it is DERIVED

Only one case needs a human, and it is the dangerous one:

    ENTITY    Has write schemas -> a client can write to this table. The contract
              applies, and drift here silently eats user data.

    DECLARED  Has write schemas, but the contract is deliberately not applied
              (telemetry) or has not been audited yet (triage). Requires an
              explicit entry WITH A REASON. The escape hatch, narrow on purpose.

    INTERNAL  No write schemas anywhere -> no client write surface. Audit logs,
              queues, ETL watermarks, one-time tokens. Nothing for a client to
              drift from, so this is DERIVED, not declared. A new server-only
              table does not need anyone to fill out a form; it just shows up as
              internal and CI stays quiet.

The invariant is therefore small and sharp: **a model with write schemas is either
under contract or an explicitly declared exception.** A new model a client can
write to cannot slip in unnoticed. A new server-only table costs nobody anything.
"""

from __future__ import annotations

import importlib
import inspect
import pkgutil
from dataclasses import dataclass
from typing import Any, Iterator

WRITE_SUFFIXES = ("Create", "Update")
SCHEMA_SUFFIXES = ("Create", "Update", "Response")


@dataclass(frozen=True)
class ModelRecord:
    """One mapped model, with whatever schema surface it turned out to have."""

    name: str
    table: str
    model: Any
    columns: dict[str, Any]
    schema_module: str | None
    schema_classes: dict[str, Any]

    @property
    def write_schemas(self) -> dict[str, Any]:
        return {
            n: c for n, c in sorted(self.schema_classes.items()) if n.endswith(WRITE_SUFFIXES)
        }

    @property
    def has_write_surface(self) -> bool:
        """A client can write to this table. This is what makes the contract apply."""
        return bool(self.write_schemas)

    def schema(self, suffix: str) -> Any | None:
        """The `<Model><suffix>` class, if it exists (e.g. DealCreate)."""
        return self.schema_classes.get(f"{self.name}{suffix}")


def _is_pydantic_model(obj: Any) -> bool:
    from pydantic import BaseModel

    return inspect.isclass(obj) and issubclass(obj, BaseModel) and obj is not BaseModel


def schema_classes_in(module: Any) -> dict[str, Any]:
    """Pydantic classes DEFINED in this module (not merely imported into it).

    The `__module__` check matters: without it, a module that re-exports another's
    schemas would claim them as its own, and the duplicate-class rule would fire on
    every import statement.
    """
    return {
        name: obj
        for name, obj in vars(module).items()
        if _is_pydantic_model(obj) and obj.__module__ == module.__name__
    }


def iter_schema_modules(
    packages: tuple[str, ...], failures: list[ImportFailure] | None = None
) -> Iterator[tuple[str, Any]]:
    """Every module in the configured packages that defines schema classes.

    NOT just `schemas/`. Real applications keep write schemas next to the routes
    that use them, and an inventory that only looked in the obvious place would
    under-report — precisely the failure mode it exists to prevent. So the caller
    configures every package worth scanning, routers included.

    A submodule that will not import is RECORDED, not swallowed. The temptation to
    swallow it ("one bad module shouldn't blind us to the others") is exactly
    backwards: a schema module that fails to import takes its Create/Update classes
    with it, so the model those schemas belonged to now appears to have no client
    write surface at all. It is then classified INTERNAL and silently dropped.

    An unimportable module does not cost us one module. It costs us an entity — and
    it costs us the entity WITHOUT SAYING SO. Hence the record: say what you could
    not see.
    """
    sink = failures if failures is not None else []

    for pkg_name in packages:
        pkg = importlib.import_module(pkg_name)  # a configured package must import

        # A plain module (not a package) is scannable on its own.
        if not hasattr(pkg, "__path__"):
            if schema_classes_in(pkg):
                yield pkg_name.replace(".", "/") + ".py", pkg
            continue

        for mod_info in sorted(pkgutil.iter_modules(pkg.__path__), key=lambda m: m.name):
            full = f"{pkg_name}.{mod_info.name}"
            try:
                module = importlib.import_module(full)
            except Exception as e:
                sink.append(ImportFailure(module=full, error=f"{type(e).__name__}: {e}"))
                continue
            if schema_classes_in(module):
                yield full.replace(".", "/") + ".py", module


@dataclass(frozen=True)
class ImportFailure:
    """A module we could not import — and therefore could not check."""

    module: str
    error: str


def _import_all(package_name: str, failures: list[ImportFailure]) -> list[Any]:
    """Import a package and every module directly under it.

    Two failure modes, deliberately treated differently:

    * The CONFIGURED PACKAGE itself will not import (`app.models` is not there, or
      blows up at import). Fatal — it propagates, and the provider turns it into a
      skip. There is nothing to check and no partial answer worth giving.

    * A SUBMODULE will not import. Recorded and reported as a violation, and the scan
      CONTINUES.

    The second case was originally fatal too, and that was wrong in a way only a real
    codebase could show. The first app I pointed this at had a dead
    backward-compat shim in models/ — re-exporting a class renamed away years ago,
    imported by nothing, rotting quietly. Aborting the entire contract check because
    of it would mean the tool cannot run until you fix a file unrelated to contracts,
    which is precisely the "linter finds a thousand problems on day one" disease this
    whole product exists to cure.

    But silently skipping it is not an option either: whatever models live in that
    module are INVISIBLE to us, so their contract goes unchecked — and would go
    unchecked without anyone knowing. So the blind spot is given a name and reported.
    Say what you could not see; check everything else.
    """
    modules = [importlib.import_module(package_name)]  # fatal if this fails
    pkg = modules[0]
    if not hasattr(pkg, "__path__"):
        return modules

    for mod_info in sorted(pkgutil.iter_modules(pkg.__path__), key=lambda m: m.name):
        full = f"{package_name}.{mod_info.name}"
        try:
            modules.append(importlib.import_module(full))
        except Exception as e:
            failures.append(ImportFailure(module=full, error=f"{type(e).__name__}: {e}"))

    return modules


def _mapped_classes(
    model_packages: tuple[str, ...], failures: list[ImportFailure]
) -> dict[str, Any]:
    """Every mapped class, from every registry we can reach.

    Importing the model packages is what POPULATES the registry — a mapper registry
    that nobody imported is empty, and an empty registry would report a clean bill
    of health for an app with fifty tables.

    Registries are discovered from the mapped classes themselves rather than from a
    configured list of declarative bases: an app with three bases (app / cache /
    marketing) should not have to enumerate them, and forgetting one would create
    exactly the invisible blind spot this module exists to close.
    """
    modules: list[Any] = []
    for pkg_name in model_packages:
        modules.extend(_import_all(pkg_name, failures))

    # Match on the real type, not on a duck.
    #
    # The first draft duck-typed this — "anything with a .registry that has .mappers"
    # — and it matched `sqlalchemy.func`, whose `_FunctionGenerator` happily answers
    # to any attribute you ask it for. Iterating it exploded. Duck typing against a
    # library built on __getattr__ magic is guessing, and a wrong guess here means
    # either a crash or, far worse, a registry we never noticed.
    from sqlalchemy.orm import registry as sa_registry

    registries: set = set()
    for module in modules:
        for obj in vars(module).values():
            reg = getattr(obj, "registry", None)
            if isinstance(reg, sa_registry):
                registries.add(reg)

    found: dict[str, Any] = {}
    for reg in registries:
        for mapper in reg.mappers:
            found[mapper.class_.__name__] = mapper.class_

    return found


def build(
    model_packages: tuple[str, ...],
    schema_packages: tuple[str, ...],
    failures: list[ImportFailure] | None = None,
) -> list[ModelRecord]:
    """The inventory. THE spine — nothing gets to be invisible.

    `failures` collects the modules we could not import. They are NOT silently
    dropped: the caller turns each one into a violation, because a module we cannot
    read is a set of models we cannot check, and that must never be indistinguishable
    from a set of models with nothing wrong.
    """
    from sqlalchemy import inspect as sa_inspect

    sink = failures if failures is not None else []

    models = _mapped_classes(model_packages, sink)
    known = set(models)

    # model name -> (home module path, {schema class name: class})
    by_model: dict[str, tuple[str, dict[str, Any]]] = {}

    for path, module in iter_schema_modules(schema_packages, sink):
        for cls_name, cls in schema_classes_in(module).items():
            for suffix in SCHEMA_SUFFIXES:
                if not cls_name.endswith(suffix):
                    continue
                entity = cls_name[: -len(suffix)]
                # Match on the SCHEMA CLASS name, not the module name: one module
                # routinely holds several entities' schemas.
                if entity not in known:
                    continue
                home, classes = by_model.setdefault(entity, (path, {}))
                classes[cls_name] = cls

    records: list[ModelRecord] = []
    for name, model in sorted(models.items()):
        module, classes = by_model.get(name, (None, {}))
        records.append(
            ModelRecord(
                name=name,
                table=getattr(model, "__tablename__", ""),
                model=model,
                columns={c.key: c for c in sa_inspect(model).columns},
                schema_module=module,
                schema_classes=classes,
            )
        )
    return records


def duplicate_class_names(schema_packages: tuple[str, ...]) -> list[dict[str, Any]]:
    """The same schema class name defined in more than one module.

    The disease in its purest form. When the two definitions have DIFFERENT fields,
    which shape a client gets depends on which endpoint it happened to hit. Nobody
    writes that on purpose; it happens because two people each needed a response
    shape and neither knew the other existed. Detecting it costs nothing.
    """
    seen: dict[str, list[tuple[str, Any]]] = {}
    for path, module in iter_schema_modules(schema_packages):
        for name, cls in schema_classes_in(module).items():
            seen.setdefault(name, []).append((path, cls))

    dupes = []
    for name, hits in sorted(seen.items()):
        if len(hits) < 2:
            continue
        fieldsets = [set(cls.model_fields) for _, cls in hits]
        dupes.append(
            {
                "name": name,
                "modules": [p for p, _ in hits],
                "drifted": any(f != fieldsets[0] for f in fieldsets[1:]),
            }
        )
    return dupes


def request_body_schemas(app_ref: str | None) -> dict[str, list[str]]:
    """Every class the API accepts as a request body -> the routes accepting it.

    ## Why the schema names are not enough

    Write schemas are found by NAME (`XCreate`, `XUpdate`). That misses any writer
    that does not follow the convention — and there are always some.
    `UpdateTierRequest` writes `organizations.tier`. `AssetFolderCreateRequest`
    writes `asset_folders`. Neither is called `OrganizationUpdate` or
    `AssetFolderCreate`, so a name-based scan calls both tables "no client write
    surface" and moves on. That is the same blind spot as the one this package
    exists to close, one level over: a scan whose miss is invisible to itself.

    Reading the route table is authoritative. If the framework parses it as a
    request body, a client can send it, whatever it happens to be called.

    THIS is why gtl-contract must import the application rather than parse it. No
    amount of static analysis can produce this list.
    """
    if not app_ref:
        return {}

    module_name, _, attr = app_ref.partition(":")
    module = importlib.import_module(module_name)
    app = getattr(module, attr or "app")

    from fastapi.routing import APIRoute
    from pydantic import BaseModel

    bodies: dict[str, list[str]] = {}
    routes = [r for r in getattr(app, "routes", []) if isinstance(r, APIRoute)]
    params_seen = 0

    for route in routes:
        for param in getattr(route.dependant, "body_params", None) or []:
            params_seen += 1
            cls = _body_param_type(param)
            if inspect.isclass(cls) and issubclass(cls, BaseModel):
                bodies.setdefault(cls.__name__, []).append(route.path)

    # If the app declares body params but we extracted a type from NONE of them,
    # our reader is broken against this version of FastAPI — and a broken reader
    # here returns {}, which means "no unaudited request bodies", which means
    # "clean". That is a guard reporting green while guarding nothing, and it is
    # the precise failure this whole tool exists to eliminate. Refuse to be it.
    if params_seen and not bodies:
        raise RuntimeError(
            f"read {len(routes)} routes with {params_seen} body param(s) but could not "
            "extract a schema type from any of them — the route-table reader is "
            "incompatible with this FastAPI version. Refusing to report a clean "
            "contract from an unreadable route table."
        )

    return {name: sorted(set(paths)) for name, paths in sorted(bodies.items())}


def _body_param_type(param: Any) -> Any:
    """The Pydantic class behind a FastAPI body param, across FastAPI versions.

    Modern FastAPI (Pydantic v2) carries it on `field_info.annotation`; older
    FastAPI (Pydantic v1) exposed `.type_`. Returning None from a bare
    `getattr(param, "type_", None)` on a modern app is exactly how this check went
    silently blind — no exception, just an empty result that read as success.
    """
    field_info = getattr(param, "field_info", None)
    annotation = getattr(field_info, "annotation", None)
    if annotation is not None:
        return annotation
    return getattr(param, "type_", None)
