import os
import sys

import pytest

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")

# The fixture apps are imported the way a real app is: from the project root, on
# sys.path. gtl-contract inserts the root itself, but tests import the fixtures
# directly too.
if FIXTURES not in sys.path:
    sys.path.insert(0, FIXTURES)

from gtl_contract.config import from_dict  # noqa: E402
from gtl_contract.providers.sqlalchemy_pydantic import SqlAlchemyPydanticProvider  # noqa: E402


def run(pkg: str, **overrides):
    """Check a fixture app and return its ProviderResult.

    `pkg` is the fixture package name; an `app=` override is the ASGI app ref, which
    is a different thing entirely — hence the deliberately distinct parameter name.
    """
    raw = {
        "models": [f"{pkg}.models"],
        "schemas": [f"{pkg}.schemas"],
        **overrides,
    }
    return SqlAlchemyPydanticProvider().check(FIXTURES, from_dict(raw))


def rule_ids(result) -> list[str]:
    return [v.rule_id for v in result.violations]


def keys_for(result, rule_id: str) -> list[str]:
    return [v.fingerprint_key for v in result.violations if v.rule_id == rule_id]


@pytest.fixture(scope="session")
def broken():
    return run("brokenapp", app="brokenapp.main:app")


@pytest.fixture(scope="session")
def clean():
    return run("cleanapp")
