#!/usr/bin/env python3
"""Run every knowledge-base fact's `verify_command`, and fail if one no longer holds.

A fact whose command no longer runs is not a fact. It is a rumour with frontmatter.

This is the same argument the rest of this project makes about everything else: a claim
nobody checks decays into a claim nobody should trust, and it decays SILENTLY. Every
contract rule in gimme-the-lint stands on a production incident, and those incidents are
written down as facts precisely so the rules cannot be deleted in a hurry by someone who
does not know why they exist. If the facts themselves go stale, that argument evaporates.

So the facts are executable, and CI executes them.

A fact may opt out with `verify_command: skip` — but the honest way to opt out is to not
make a claim you cannot check.
"""

from __future__ import annotations

import os
import pathlib
import re
import subprocess
import sys

try:
    import yaml
except ImportError:
    print("verify-facts: pyyaml is required (pip install pyyaml)", file=sys.stderr)
    sys.exit(2)

ROOT = pathlib.Path(__file__).resolve().parents[1]
FACTS = ROOT / ".documentation" / "knowledge-base" / "facts"

# Some claims are about a REAL project's data ("48 of 243 routes"), and cannot be proved
# from inside this repo. They are marked here rather than silently skipped, so that the
# list of things we do NOT check stays visible and stays short.
NEEDS_A_LIVE_PROJECT = {
    "hand-written-client-types-drift-by-inventing",
}


def frontmatter(path: pathlib.Path) -> dict:
    m = re.match(r"---\n(.*?)\n---", path.read_text(), re.S)
    return yaml.safe_load(m.group(1)) if m else {}


def main() -> int:
    if not FACTS.is_dir():
        print("verify-facts: no knowledge-base/facts directory — nothing to prove")
        return 0

    # The project's own venv first, so a fact can import sqlalchemy/pydantic/fastapi.
    venv = ROOT / "python" / ".venv" / "bin"
    env = dict(os.environ)
    if venv.is_dir():
        env["PATH"] = f"{venv}{os.pathsep}{env['PATH']}"

    proven = failed = skipped = 0

    for path in sorted(FACTS.glob("*.md")):
        fm = frontmatter(path)

        # hewtd generates INDEX.md / REGISTRY.md into every domain. They are not facts,
        # and counting them as unverifiable ones would pad the "unverifiable" number —
        # which is the number that must stay small and honest.
        if fm.get("tier") != "fact":
            continue

        fact_id = fm.get("id", path.stem)
        command = fm.get("verify_command")

        if not command or command == "skip":
            print(f"  ⊘ no verify_command: {fact_id}")
            skipped += 1
            continue

        if fact_id in NEEDS_A_LIVE_PROJECT:
            print(f"  ⊘ needs a live project: {fact_id}")
            skipped += 1
            continue

        result = subprocess.run(
            ["bash", "-c", command],
            capture_output=True,
            text=True,
            env=env,
            timeout=120,
        )

        if result.returncode == 0:
            tail = [ln for ln in result.stdout.strip().split("\n") if ln]
            print(f"  ✓ {fact_id}")
            if tail:
                print(f"      {tail[-1]}")
            proven += 1
        else:
            print(f"  ✗ {fact_id} — THE CLAIM NO LONGER HOLDS")
            detail = (result.stderr or result.stdout).strip().split("\n")
            for line in detail[-3:]:
                print(f"      {line}")
            failed += 1

    print()
    print(f"proven: {proven}   failed: {failed}   unverifiable: {skipped}")

    if failed:
        print()
        print("A fact whose command no longer runs is a rumour with frontmatter.")
        print("Either the world changed and the fact must be updated — or the fact was")
        print("wrong, and every rule citing it needs re-reading.")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
