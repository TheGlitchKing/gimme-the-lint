"""The exit-code protocol, and the one collision it must never make.

#17: `gtl-contract check` exits 0 with 137 violations, so anyone wiring the Python
checker straight into CI gets a job that can never fail — a gate that looks like a gate
and is not one.

The reported fix — "exit non-zero when `violations` is non-empty" — **must not be
implemented as filed**, and this file is where that is nailed down. Exit 1 already means
*we could not check*, and `lib/adapters/contract.js` reads it that way. Overloading it
with *we found something* collides the two facts this protocol exists to keep apart: a run
that found 137 real violations would reach the engine as a SKIP, be warned about, and
never block. The suggested fix turns a working gate into a silent one.

So "checked, found violations" gets its own code, 3, and it is opt-in.

    exit 0  checked; violations may be empty or not
    exit 1  could NOT check
    exit 2  used wrong
    exit 3  checked and found violations — only with --exit-code
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


def run(*args: str, cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "gtl_contract.cli", *args],
        capture_output=True,
        text=True,
        cwd=cwd,
    )


def config_for(app: str, tmp_path: Path) -> str:
    # Named per app, not "cfg.json": a test taking both fixtures would otherwise have
    # the second overwrite the first and silently assert against the wrong app.
    cfg = tmp_path / f"{app}.json"
    cfg.write_text(json.dumps({"models": [f"{app}.models"], "schemas": [f"{app}.schemas"]}))
    return str(cfg)


@pytest.fixture
def broken_cfg(tmp_path):
    return config_for("brokenapp", tmp_path)


@pytest.fixture
def clean_cfg(tmp_path):
    return config_for("cleanapp", tmp_path)


# --- the default is unchanged -----------------------------------------------------


def test_violations_still_exit_0_by_DEFAULT(broken_cfg):
    """Not a behavior change. Turning this on by default would break every existing
    caller's CI on a minor upgrade, and the engine does not want it: it reads `checked`
    and `violations` off the JSON, which is richer than any status."""
    r = run("check", "--root", str(FIXTURES), "--config", broken_cfg)

    assert r.returncode == 0
    assert json.loads(r.stdout)["violations"], "the fixture must actually have findings"


# --- opt in -----------------------------------------------------------------------


def test_exit_code_returns_3_when_violations_are_found(broken_cfg):
    r = run("check", "--root", str(FIXTURES), "--config", broken_cfg, "--exit-code")

    assert r.returncode == 3
    payload = json.loads(r.stdout)
    assert payload["checked"] is True
    assert payload["violations"]


def test_exit_code_returns_0_on_a_genuinely_clean_run(clean_cfg):
    """A rule that cannot be satisfied is a rule that gets disabled — and a flag that
    always fails is a flag that gets removed."""
    r = run("check", "--root", str(FIXTURES), "--config", clean_cfg, "--exit-code")

    assert r.returncode == 0
    assert json.loads(r.stdout)["violations"] == []


# --- the collision this exists to avoid -------------------------------------------


def test_a_SKIP_is_still_1_even_with_exit_code(tmp_path):
    """The whole reason the new code is 3.

    "We could not look" must stay distinguishable from "we looked and found things".
    If a skip returned 3, or a finding returned 1, the two would be the same number and
    opposite facts — and the engine maps exit 1 onto its skip contract (warn, never
    block). A findings run reported as a skip is a gate that stopped gating.
    """
    cfg = tmp_path / "cfg.json"
    cfg.write_text(json.dumps({"models": ["nope.does_not_exist"], "schemas": []}))

    r = run("check", "--root", str(FIXTURES), "--config", str(cfg), "--exit-code")

    assert r.returncode == 1, "could-not-check outranks found-violations"
    payload = json.loads(r.stdout)
    assert payload["checked"] is False
    assert payload["skip"], "and it must say why"


def test_a_skip_is_1_without_the_flag_too(tmp_path):
    """Unchanged. --exit-code adds a code; it never removes one."""
    cfg = tmp_path / "cfg.json"
    cfg.write_text(json.dumps({"models": ["nope.does_not_exist"], "schemas": []}))

    r = run("check", "--root", str(FIXTURES), "--config", str(cfg))

    assert r.returncode == 1
    assert json.loads(r.stdout)["checked"] is False


def test_the_three_outcomes_are_three_DIFFERENT_numbers(broken_cfg, clean_cfg, tmp_path):
    """Stated as one assertion, because the property is about the SET.

    Every outcome must be distinguishable from success (principle 1). "We found nothing"
    and "we could not look" are the same number of violations and opposite facts.
    """
    skip_cfg = tmp_path / "skip.json"
    skip_cfg.write_text(json.dumps({"models": ["nope.does_not_exist"], "schemas": []}))

    codes = {
        "clean": run("check", "--root", str(FIXTURES), "--config", clean_cfg, "--exit-code").returncode,
        "found": run("check", "--root", str(FIXTURES), "--config", broken_cfg, "--exit-code").returncode,
        "could-not-look": run("check", "--root", str(FIXTURES), "--config", str(skip_cfg), "--exit-code").returncode,
    }

    assert codes == {"clean": 0, "found": 3, "could-not-look": 1}
    assert len(set(codes.values())) == 3


# --- misuse is still 2 ------------------------------------------------------------


def test_a_bad_flag_is_still_2():
    r = run("check", "--nonsense")

    assert r.returncode == 2


# --- and stdout stays parseable ---------------------------------------------------


def test_stdout_is_still_exactly_one_json_object_in_every_case(broken_cfg):
    """The status is an addition to the protocol, not a replacement for it.

    An unparseable linter is a silently absent one, so the payload must survive the
    new exit path unchanged.
    """
    for extra in ([], ["--exit-code"]):
        r = run("check", "--root", str(FIXTURES), "--config", broken_cfg, *extra)
        payload = json.loads(r.stdout)  # raises if anything else landed on stdout
        assert set(payload) >= {"checked", "provider", "violations"}
