"""The currency gtl-contract emits: one violation, JSON-serializable.

This mirrors `lib/violation.js` on the Node side. gtl-contract knows nothing about
baselines, fingerprints, git, or `.gtl/` — it is a linter. It reads an application
and prints what is wrong with it. Everything progressive (is this new? was it
grandfathered? has it been fixed?) happens in the engine that calls us.

That separation is the whole reason this can be an adapter like any other: the
engine treats our JSON exactly as it treats ruff's or eslint's.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

SEVERITY_ERROR = "error"
SEVERITY_WARNING = "warning"


@dataclass(frozen=True)
class Violation:
    """One contract finding.

    `fingerprint_key` is the important field, and the reason the engine grew
    support for it. A contract violation's identity is the THING it is about —
    `Deal.operating_expenses:writable` — not the file it happened to be declared
    in, and not the message text.

    Both alternatives are actively wrong here:

    * The file moves. Schemas get reorganized (`app/schemas/deal.py` ->
      `app/domain/deal/schemas.py`) far more often than source code does, and a
      path-keyed baseline would evaporate on the rename, resurrecting every
      finding it had grandfathered.

    * The message enumerates a SET. "no write schema accepts [a, b]" becomes
      "...[a, b, c]" the moment a third column goes missing — a different string,
      therefore a different fingerprint, therefore the two already-known problems
      come back as new. The key pins identity to one column and one rule, so
      each missing column is its own finding that can be fixed independently.
    """

    rule_id: str
    message: str
    fingerprint_key: str
    file: str = ""
    line: int = 0
    severity: str = SEVERITY_ERROR

    # Set from the rule's own metadata (see rules.py). Carried on the violation
    # rather than looked up by the engine, so the engine never needs a hardcoded
    # list of which rules are un-baselineable — rules belong to the provider,
    # exactly as ESLint's rules belong to ESLint.
    never_baseline: bool = False

    # Free-form, for the human reading the failure. Not part of identity.
    context: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        """The wire shape. Keys are camelCase to match NormalizedViolation."""
        out: dict[str, Any] = {
            "file": self.file,
            "line": self.line,
            "ruleId": self.rule_id,
            "severity": self.severity,
            "message": self.message,
            "fingerprintKey": self.fingerprint_key,
            "source": "contract",
        }
        # Emitted only when true, so a debt-class violation's JSON is unchanged
        # from what a plain linter would produce.
        if self.never_baseline:
            out["neverBaseline"] = True
        if self.context:
            out["context"] = self.context
        return out


def sort_violations(violations: list[Violation]) -> list[Violation]:
    """Stable, deterministic order.

    Two runs over an unchanged codebase must produce byte-identical output, or
    every run looks like a change. Python's set/dict iteration is insertion-
    ordered but the sets we build them from are not, so sort explicitly.
    """
    return sorted(violations, key=lambda v: (v.rule_id, v.fingerprint_key, v.file))
