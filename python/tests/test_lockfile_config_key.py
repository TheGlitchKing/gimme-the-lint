"""The `lockfile` config key was decorative. (#22)

`cmd_openapi` read only `args.lockfile`, and `Config` had no `lockfile` field at all — so
`cfg.lockfile` would have raised `AttributeError` had anyone tried. A config carrying
`lockfile: 'openapi.json'` was therefore ignored, and the failure mode was a rule
insisting the lockfile was missing while the reader was looking straight at it:

    contract/lockfile-missing: No API contract lockfile...
    Run: gimme-the-lint materialize

Following that advice does not help. `materialize` writes the file, and the file is then
not read — false guidance stacked on a false finding (principle 4).

## Narrower than filed, and worth saying so

The Node adapter ALWAYS passes `--lockfile`, so this never bit anyone going through
`gimme-the-lint check`. It bit people driving `gtl-contract` directly — which, since
2.9.0, is a documented and supported thing to do.

(The issue's snippet cites `cmd_check`; the code is `cmd_openapi`.)
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from gtl_contract.config import from_dict

FIXTURES = Path(__file__).parent / "fixtures"


def run(*args: str, cwd: Path) -> dict:
    proc = subprocess.run(
        [sys.executable, "-m", "gtl_contract.cli", *args],
        capture_output=True,
        text=True,
        cwd=cwd,
    )
    return json.loads(proc.stdout)


def rule_ids(payload: dict) -> list[str]:
    return [v["ruleId"] for v in payload["violations"]]


@pytest.fixture
def project(tmp_path):
    """A materialized lockfile sitting right there, next to a config that names it."""
    base = {
        "models": ["brokenapp.models"],
        "schemas": ["brokenapp.schemas"],
        "app": "brokenapp.main:app",
    }
    (tmp_path / "cfg-with-lockfile.json").write_text(json.dumps({**base, "lockfile": "openapi.json"}))
    (tmp_path / "cfg-bare.json").write_text(json.dumps(base))
    (tmp_path / "cfg-wrong.json").write_text(json.dumps({**base, "lockfile": "nope.json"}))

    emitted = subprocess.run(
        [sys.executable, "-m", "gtl_contract.cli", "openapi",
         "--root", str(FIXTURES), "--config", str(tmp_path / "cfg-bare.json"), "--emit"],
        capture_output=True, text=True, cwd=tmp_path,
    )
    (tmp_path / "openapi.json").write_text(emitted.stdout)
    return tmp_path


# --- the config field exists at all ----------------------------------------------


def test_config_has_a_lockfile_field():
    """It had none. `cfg.lockfile` would have raised AttributeError."""
    cfg = from_dict({"lockfile": "backend/openapi.json"})

    assert cfg.lockfile == "backend/openapi.json"


def test_it_defaults_to_None_not_a_guess():
    assert from_dict({}).lockfile is None


# --- the reported bug -------------------------------------------------------------


def test_the_config_key_is_HONOURED_with_no_flag(project):
    """The whole issue: a lockfile named only in config used to be invisible."""
    payload = run("openapi", "--root", str(FIXTURES), "--config", "cfg-with-lockfile.json", cwd=project)

    assert "contract/lockfile-missing" not in rule_ids(payload)


def test_without_the_key_or_the_flag_it_is_STILL_reported_missing(project):
    """The rule must keep working. A fix that made lockfile-missing unreachable would
    be worse than the bug — that rule is the reason the lockfile exists."""
    payload = run("openapi", "--root", str(FIXTURES), "--config", "cfg-bare.json", cwd=project)

    assert "contract/lockfile-missing" in rule_ids(payload)


def test_a_config_naming_a_file_that_is_NOT_THERE_still_reports_missing(project):
    """Naming a path is not the same as having the file. Trusting the key rather than
    the filesystem would turn this rule off for anyone with a typo."""
    payload = run("openapi", "--root", str(FIXTURES), "--config", "cfg-wrong.json", cwd=project)

    assert "contract/lockfile-missing" in rule_ids(payload)


# --- precedence, and why it differs from `app` ------------------------------------


def test_the_FLAG_wins_over_the_config(project):
    """Not merely conventional — REQUIRED, and the Node path depends on it.

    `lib/adapters/openapi.js` passes `--lockfile` with a path already resolved against
    appRoot (absolute), while `_writeConfigFile()` writes the RAW relative value into the
    config it hands over. If the config won, Python would resolve the relative path
    against its own cwd instead of using the one the adapter computed.

    So: flag wins, and the Node path is byte-identical to before this fix.
    """
    payload = run(
        "openapi", "--root", str(FIXTURES), "--config", "cfg-wrong.json",
        "--lockfile", str(project / "openapi.json"), cwd=project,
    )

    # cfg says nope.json (missing); the flag says the real file. The flag must win.
    assert "contract/lockfile-missing" not in rule_ids(payload)


def test_app_deliberately_resolves_the_OTHER_way_round():
    """`cfg.app or args.app` — config first — and that is not an oversight to homogenize.

    No adapter passes `--app`, so config is the only source on the Node path and
    precedence never arises there. `lockfile` is the opposite case: the adapter passes a
    RESOLVED path on the flag and a RAW one in the config, so the flag has to win.

    Pinned because the two lines sit next to each other and look like an inconsistency.
    """
    import inspect

    from gtl_contract import cli

    source = inspect.getsource(cli.cmd_openapi)
    assert "cfg.app or args.app" in source
    assert "args.lockfile or cfg.lockfile" in source
