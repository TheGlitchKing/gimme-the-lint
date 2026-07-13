"""The most dangerous failure this package can have.

Every one of these situations produces ZERO violations:

    the app will not import
    the ORM registry is empty
    no model package was found
    the route-table reader is broken

Zero violations reads as "clean". If any of them were reported as a pass, the user
would be told their contract is sound at exactly the moment we could not see it —
a guard reporting green while guarding nothing. That is the precise failure this
entire tool exists to eliminate, so it must not be how the tool itself fails.

`checked` is therefore an explicit boolean, and `checked=False` is NOT `violations=[]`.
"""

from __future__ import annotations

import os
import textwrap

import pytest

from gtl_contract.config import from_dict
from gtl_contract.providers.sqlalchemy_pydantic import SqlAlchemyPydanticProvider

from .conftest import FIXTURES


def check(root=FIXTURES, **raw):
    return SqlAlchemyPydanticProvider().check(root, from_dict(raw))


def test_no_model_package_is_skipped_not_clean(tmp_path):
    result = check(root=str(tmp_path))

    assert result.checked is False, "an app we never found must not be reported as clean"
    assert result.violations == []
    assert result.skip and "model package" in result.skip


def test_an_unimportable_app_is_skipped_with_a_traceback(tmp_path):
    """The user needs to know WHY. "Skipped" with no cause is unactionable."""
    pkg = tmp_path / "boomapp" / "models"
    pkg.mkdir(parents=True)
    (tmp_path / "boomapp" / "__init__.py").write_text("")
    (pkg / "__init__.py").write_text(
        textwrap.dedent(
            """
            # Exactly the real-world case: a model module that reaches for the
            # database (or an env var, or a secret) at import time.
            raise RuntimeError("DATABASE_URL is not set")
            """
        )
    )

    result = check(root=str(tmp_path), models=["boomapp.models"], schemas=[])

    assert result.checked is False
    assert result.violations == []
    assert "could not import" in result.skip
    assert "DATABASE_URL is not set" in result.detail, "the cause must reach the user"


def test_an_empty_registry_is_skipped_not_clean(tmp_path):
    """An importable models package with no models in it.

    The nightmare: it imports fine, finds nothing, and reports a clean contract for
    an application with fifty tables. Refuse.
    """
    pkg = tmp_path / "emptyapp" / "models"
    pkg.mkdir(parents=True)
    (tmp_path / "emptyapp" / "__init__.py").write_text("")
    (pkg / "__init__.py").write_text("# no models here\n")

    result = check(root=str(tmp_path), models=["emptyapp.models"], schemas=[])

    assert result.checked is False
    assert result.violations == []
    assert "no mapped models" in result.skip
    assert "not a clean one" in result.skip, "say the quiet part out loud"


def test_an_unreadable_route_table_raises_rather_than_reporting_clean():
    """If we cannot extract types from the route table, we must not say "no unaudited bodies".

    This is not hypothetical: the first implementation read `param.type_`, which is
    the Pydantic v1 shape. On modern FastAPI it returned None for every route — no
    exception, just an empty result that read as success. The check went silently
    blind, and a defensive `getattr(..., None)` was the whole cause.
    """
    from gtl_contract.providers.sqlalchemy_pydantic import inventory

    original = inventory._body_param_type
    inventory._body_param_type = lambda param: None  # simulate the version skew
    try:
        with pytest.raises(RuntimeError, match="could not extract a schema type"):
            inventory.request_body_schemas("brokenapp.main:app")
    finally:
        inventory._body_param_type = original


def test_a_genuinely_clean_app_IS_reported_as_checked(clean):
    """The other side of the coin: don't cry wolf either."""
    assert clean.checked is True
    assert clean.violations == []


def test_missing_libraries_are_skipped_not_crashed(monkeypatch, tmp_path):
    """A repo with no SQLAlchemy installed is not a broken repo; it is a repo we skip."""
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name in ("sqlalchemy", "pydantic"):
            raise ImportError(f"No module named {name!r}")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)

    result = check(root=str(tmp_path), models=["whatever"])

    assert result.checked is False
    assert result.violations == []
    assert "not installed" in result.skip
