"""The SQLAlchemy + Pydantic provider (FastAPI's stack).

Binds the persistence layer (SQLAlchemy models) to the transport layer (Pydantic
Create/Update/Response schemas) and checks that they agree.

## Why this imports your application instead of parsing it

Because the authoritative list of "what a client can write" lives in the route
table, not in the filenames. Write schemas are conventionally named `XCreate` /
`XUpdate`, but the ones that AREN'T — `UpdateTierRequest` writing `organizations`,
`AssetFolderCreateRequest` writing `asset_folders` — are precisely the ones nobody
has audited, and precisely the ones a name-based static scan reports as "no write
surface" before moving on. A scan whose miss is invisible to itself is worse than
no scan, because it is believed.

So we import. The cost is real: a missing venv, an absent library, a module that
opens a database connection at import time, all become failure modes. Every one of
them resolves to `ProviderResult.skipped(...)` — loud, explained, and NEVER
blocking. A skip means UNCHECKED. It must never be laundered into a pass.
"""

from __future__ import annotations

import os
import sys
import traceback

from ...config import Config
from ...violation import Violation, sort_violations
from ..base import ProviderResult
from . import checks, inventory

# Where model / schema packages live in a conventional FastAPI layout. Used only
# when the config does not say — an explicit config always wins.
DEFAULT_MODEL_PACKAGES = ("app.models", "models")
DEFAULT_SCHEMA_PACKAGES = ("app.schemas", "app.routers", "schemas", "routers")
DEFAULT_APP_REFS = ("app.main:app", "main:app")


class SqlAlchemyPydanticProvider:
    id = "sqlalchemy+pydantic"

    def detect(self, root: str, config: Config) -> bool:
        """Cheap check: is this stack even plausibly present?

        Deliberately does NOT import the app — detect() runs on every unit, and
        importing an application to discover it is not one would be absurd.
        """
        try:
            import pydantic  # noqa: F401
            import sqlalchemy  # noqa: F401
        except ImportError:
            return False

        if config.models:
            return True
        return any(
            os.path.isdir(os.path.join(root, *pkg.split(".")))
            for pkg in DEFAULT_MODEL_PACKAGES
        )

    def check(self, root: str, config: Config) -> ProviderResult:
        # The app under inspection is imported from the project root, using ITS
        # interpreter and ITS installed libraries. sys.path has to include the root
        # or `import app.models` finds nothing.
        if root not in sys.path:
            sys.path.insert(0, root)

        try:
            import pydantic  # noqa: F401
            import sqlalchemy  # noqa: F401
        except ImportError as e:
            return ProviderResult.skipped(
                "SQLAlchemy and Pydantic are not installed in this environment",
                detail=str(e),
            )

        model_packages = config.models or self._guess(root, DEFAULT_MODEL_PACKAGES)
        schema_packages = config.schemas or self._guess(root, DEFAULT_SCHEMA_PACKAGES)

        if not model_packages:
            return ProviderResult.skipped(
                "no model package found — set contract.models in .gtl/config.js "
                f"(looked for: {', '.join(DEFAULT_MODEL_PACKAGES)})"
            )

        # Modules we could not import. NOT fatal — each becomes a violation naming the
        # blind spot it created. A configured PACKAGE that will not import is still
        # fatal (there is nothing to check); a submodule is a hole we can describe.
        failures: list[inventory.ImportFailure] = []

        try:
            records = inventory.build(
                tuple(model_packages), tuple(schema_packages), failures
            )
        except Exception:
            # Importing the app is the one genuinely dangerous thing we do. If the
            # configured package itself blows up we hand back the traceback and skip —
            # we do NOT guess, and we do not pretend the app is clean.
            return ProviderResult.skipped(
                "could not import the application's models",
                detail=traceback.format_exc(limit=6),
            )

        # An empty inventory is the nightmare case: zero models means zero
        # violations means "clean", and the user is told their contract is sound
        # when in fact we never saw it. Refuse to report on what we could not read.
        if not records:
            return ProviderResult.skipped(
                f"imported {', '.join(model_packages)} but found no mapped models — "
                "the ORM registry is empty, so there is nothing to check. This is "
                "reported rather than passed: an empty inventory is not a clean one."
            )

        violations: list[Violation] = list(checks.unimportable_modules(failures, config))

        for record in records:
            # THE ENTITY CONTRACT APPLIES TO MODELS A CLIENT CAN WRITE TO.
            #
            # No write schemas means no client write surface, which means nothing can
            # drift: there is no request whose fields could disagree with the table.
            # An audit log, a queue, an ETL watermark — and equally a READ-ONLY
            # projection with nothing but a Response schema — have no contract to
            # break.
            #
            # This is DERIVED, not declared. A new server-only table costs nobody a
            # line of config, which is the only reason people keep adding tables (and
            # keep running the checker).
            #
            # The first draft got this wrong: it skipped only models with NO schemas at
            # all, so a model with a lone Response schema was still held to the write
            # rules — and duly reported that "no write schema accepts `x`" for every
            # column it had. On a real codebase that was 165 findings, every one of
            # them noise, on four read-only projections. Nothing teaches people to
            # ignore a linter faster.
            if not record.has_write_surface:
                continue
            if record.name in config.classifications:
                continue  # deliberately, and explainedly, out of scope
            for check in checks.ENTITY_CHECKS:
                violations.extend(check(record, config))

        violations.extend(checks.classified_models_are_honest(records, config))
        violations.extend(checks.exceptions_have_reasons(records, config))
        violations.extend(checks.unregistered_models(records, config))

        try:
            dupes = inventory.duplicate_class_names(tuple(schema_packages))
            violations.extend(checks.duplicate_schema_classes(dupes, config))
        except Exception:
            return ProviderResult.skipped(
                "could not scan the schema modules for duplicates",
                detail=traceback.format_exc(limit=6),
            )


        # The route table is the AUTHORITATIVE list of what a client can write —
        # the only place the non-conventional writers (`UpdateTierRequest` ->
        # organizations) are visible at all. If we cannot read it, we cannot claim
        # to know the write surface, and reporting the violations we DID find would
        # imply we found them all.
        app_ref = config.app or self._guess_app(root)
        if app_ref:
            try:
                bodies = inventory.request_body_schemas(app_ref)
            except Exception:
                return ProviderResult.skipped(
                    f"could not read the route table from {app_ref}",
                    detail=traceback.format_exc(limit=6),
                )
            violations.extend(checks.unaudited_request_bodies(bodies, records, config))

        return ProviderResult.ok(sort_violations(violations))

    @staticmethod
    def _guess(root: str, candidates: tuple[str, ...]) -> list[str]:
        return [
            pkg
            for pkg in candidates
            if os.path.isdir(os.path.join(root, *pkg.split(".")))
        ]

    @staticmethod
    def _guess_app(root: str) -> str | None:
        for ref in DEFAULT_APP_REFS:
            module = ref.split(":")[0]
            if os.path.exists(os.path.join(root, *module.split("."))) or os.path.exists(
                os.path.join(root, *module.split(".")) + ".py"
            ):
                return ref
        return None
