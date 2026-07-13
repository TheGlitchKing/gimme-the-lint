"""Bugs the first real codebase found in this checker.

Every test here is a regression guard for something the fixtures did not catch and a
production repository did, on the very first run. They are worth keeping separate:
they are a standing reminder that a passing fixture suite is not evidence of
correctness, only of self-consistency.
"""

from __future__ import annotations

import pathlib
import textwrap

import pytest

from gtl_contract import rules as R

from .conftest import keys_for, rule_ids, run


# --- 1. A read-only model has no contract to break -------------------------------


def test_a_model_with_only_a_response_schema_is_not_checked_for_writes(tmp_path):
    """165 findings, every one of them noise.

    Four models in the real app had a lone Response schema and no Create/Update:
    Lead, Document, Organization, UserProfile. They are read-only projections — a
    client cannot write to them at all.

    The first draft skipped only models with NO schemas whatsoever, so these were
    still held to the write rules, and duly reported that "no write schema accepts
    `x`" for every column they had. Which is true, and completely meaningless: there
    is no write surface for the columns to disagree with.

    The entity contract applies to models a client can WRITE to. No write schemas
    means nothing can drift. This is derived, never declared — and getting it wrong
    is how you teach people to ignore a linter.
    """
    app = tmp_path / "readonly"
    (app / "models").mkdir(parents=True)
    (app / "schemas").mkdir()
    (app / "__init__.py").write_text("")

    (app / "models" / "__init__.py").write_text(
        textwrap.dedent(
            """
            from sqlalchemy import Column, String, Float
            from sqlalchemy.orm import DeclarativeBase

            class Base(DeclarativeBase):
                pass

            class Lead(Base):
                __tablename__ = "leads"
                lead_id = Column(String, primary_key=True)
                score = Column(Float)
                source = Column(String)
                notes = Column(String)
            """
        )
    )
    (app / "schemas" / "__init__.py").write_text(
        textwrap.dedent(
            """
            from typing import Optional
            from pydantic import BaseModel

            class LeadResponse(BaseModel):
                lead_id: str
                score: Optional[float] = None
                # `source` and `notes` are deliberately not exposed. That is a
                # projection, not drift.
            """
        )
    )

    from gtl_contract.config import from_dict
    from gtl_contract.providers.sqlalchemy_pydantic import SqlAlchemyPydanticProvider

    result = SqlAlchemyPydanticProvider().check(
        str(tmp_path),
        from_dict({"models": ["readonly.models"], "schemas": ["readonly.schemas"]}),
    )

    assert result.checked is True
    assert result.violations == [], [v.fingerprint_key for v in result.violations]


# --- 2. A stale declaration is a live exemption -----------------------------------


def test_a_serverManaged_column_that_no_longer_exists_is_caught():
    """Found in the real app's own registry, twice.

    `Deal` and `Property` both declared `user_id` as server-managed. Neither model has
    had a `user_id` column for some time.

    Their hand-written contract engine could not see this: it only ever checks that a
    declared column is EXCLUDED from the rules, never that the declaration names
    something real. So the line just sat there.

    It is not cosmetic. A dead declaration is still a LIVE EXEMPTION — the day
    somebody re-adds a `user_id` column, it arrives pre-exempted from the contract,
    and the guard that was supposed to catch it stays quiet. A stale exception quietly
    loosens the ratchet.
    """
    result = run(
        "brokenapp",
        app="brokenapp.main:app",
        entities={"Deal": {"serverManaged": ["user_id_that_was_renamed_away"]}},
    )

    assert "Deal.user_id_that_was_renamed_away:stale-server-managed" in keys_for(
        result, R.STALE_EXCEPTION.id
    )


# --- 3. An unimportable module is a blind spot, not a crash -----------------------


def test_an_unimportable_submodule_is_reported_and_the_scan_continues(tmp_path):
    """The real app had a dead backward-compat shim in models/.

    `app/models/folder.py` re-exported a `Folder` class that had been renamed away.
    Nothing imported it, so it rotted quietly — and would have exploded the instant
    anyone touched it.

    Two wrong answers were available:

      * ABORT the whole check. Then the tool cannot run until you fix a file that has
        nothing to do with contracts — the "linter finds a thousand problems on day
        one" disease this product exists to cure.

      * SKIP it silently. Then any models inside it are invisible, their contracts go
        unchecked, and nobody ever finds out.

    So: name the blind spot, and check everything else.
    """
    app = tmp_path / "rotten"
    (app / "models").mkdir(parents=True)
    (app / "schemas").mkdir()
    (app / "__init__.py").write_text("")
    (app / "models" / "__init__.py").write_text(
        textwrap.dedent(
            """
            from sqlalchemy import Column, String
            from sqlalchemy.orm import DeclarativeBase

            class Base(DeclarativeBase):
                pass

            class Widget(Base):
                __tablename__ = "widgets"
                widget_id = Column(String, primary_key=True)
                name = Column(String)
            """
        )
    )
    # The shim: imports a name that no longer exists anywhere.
    (app / "models" / "legacy.py").write_text(
        "from rotten.models import Folder  # renamed away years ago\n"
    )
    (app / "schemas" / "__init__.py").write_text(
        textwrap.dedent(
            """
            from typing import Optional
            from pydantic import BaseModel, ConfigDict

            class WidgetCreate(BaseModel):
                model_config = ConfigDict(extra="forbid")
                name: str

            class WidgetUpdate(BaseModel):
                model_config = ConfigDict(extra="forbid")
                name: Optional[str] = None

            class WidgetResponse(BaseModel):
                widget_id: str
                name: Optional[str] = None
            """
        )
    )

    from gtl_contract.config import from_dict
    from gtl_contract.providers.sqlalchemy_pydantic import SqlAlchemyPydanticProvider

    result = SqlAlchemyPydanticProvider().check(
        str(tmp_path),
        from_dict({"models": ["rotten.models"], "schemas": ["rotten.schemas"]}),
    )

    # It did NOT abort...
    assert result.checked is True
    # ...it named the blind spot...
    assert "rotten.models.legacy:unimportable" in keys_for(result, R.UNIMPORTABLE_MODULE.id)
    # ...and it still checked the model it COULD see (Widget is clean, so nothing else).
    assert len(result.violations) == 1


# --- 4. The app talks. It must not talk on our wire -------------------------------


def test_stdout_written_by_the_app_at_import_does_not_corrupt_the_report(tmp_path):
    """The real app configured structlog at import and logged to STDOUT.

    A single JSON line — "CORS configured for development..." — landed above our
    report and made the whole thing unparseable. The engine would have seen a linter
    that produced garbage, and a linter that produces garbage is a linter that is
    silently absent.

    We cannot control what an app prints when imported, so we quarantine fd 1 for the
    duration and give it back afterwards.

    Run as a SUBPROCESS, deliberately. pytest's capfd does its own file-descriptor
    juggling, and a test that fights the harness proves nothing about the real thing.
    This is how the checker actually runs: a process the engine spawns and whose
    stdout it parses.
    """
    import json
    import os
    import subprocess
    import sys

    app = tmp_path / "chatty"
    (app / "models").mkdir(parents=True)
    (app / "schemas").mkdir()
    (app / "__init__.py").write_text("")
    (app / "models" / "__init__.py").write_text(
        textwrap.dedent(
            """
            import sys
            from sqlalchemy import Column, String
            from sqlalchemy.orm import DeclarativeBase

            # Exactly the real case: an application that talks while it is being
            # imported. structlog, a banner, a deprecation warning, a CORS log line.
            print('{"event": "CORS configured", "level": "info"}')
            print("plain-text chatter too", flush=True)

            class Base(DeclarativeBase):
                pass

            class Thing(Base):
                __tablename__ = "things"
                thing_id = Column(String, primary_key=True)
            """
        )
    )
    (app / "schemas" / "__init__.py").write_text("")

    cfg = tmp_path / "cfg.json"
    cfg.write_text(json.dumps({"models": ["chatty.models"], "schemas": ["chatty.schemas"]}))

    env = {**os.environ, "PYTHONPATH": str(pathlib.Path(__file__).resolve().parents[2])}
    proc = subprocess.run(
        [sys.executable, "-m", "gtl_contract", "check", "--root", str(tmp_path),
         "--config", str(cfg)],
        capture_output=True,
        text=True,
        env=env,
    )

    # The whole point: stdout is parseable. One object, nothing above it.
    report = json.loads(proc.stdout)
    assert report["checked"] is True

    # And the app's chatter was redirected, not destroyed — a human debugging a skip
    # still needs to see it.
    assert "CORS configured" in proc.stderr
    assert "plain-text chatter" in proc.stderr


# --- 5. Duck typing against a library built on __getattr__ is guessing -------------


def test_registry_discovery_does_not_match_sqlalchemy_func():
    """`sqlalchemy.func` answers to any attribute you ask it for.

    Registry discovery originally duck-typed — "anything with a `.registry` that has
    `.mappers`" — and matched `func`, whose `_FunctionGenerator` cheerfully returns a
    truthy object for `.registry.mappers`. Iterating it raised TypeError.

    A wrong guess here means a crash, or (far worse) a real registry we never noticed.
    Match the type.
    """
    import sqlalchemy
    from sqlalchemy.orm import registry as sa_registry

    assert not isinstance(getattr(sqlalchemy.func, "registry", None), sa_registry)
