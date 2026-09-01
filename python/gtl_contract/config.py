"""Authored configuration — the DECISIONS half of decision-vs-debt.

There are two ways a contract violation can be allowed to persist, and conflating
them loses the thing worth knowing:

  BASELINE (generated, `.gtl/apps/<app>/baseline.json`)
      Debt. Auto-captured, reasonless, blocks anything NEW, shrinks over time.
      "Nobody has looked at this yet." Perfectly honest, and cheap.

  CONFIG (authored, `.gtl/config.js`)
      A decision. Hand-written, and the reason is MANDATORY.
      "We looked at this, and it is deliberate."

A flat baseline flattens both into "grandfathered", which loses the difference
between *we thought about this* and *nobody has looked*. That difference is the
entire value of the reason field: an unexplained omission is indistinguishable
from the bug it is hiding.

The reason is also the escape hatch for a DEFECT — the one class of finding that
can never be baselined. You can still declare it here, but you have to write the
sentence. Nobody types "we accept that GET /conversations returns 500 for every
user." The friction is the feature.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# A reason must actually say something. Ported from RE-InvestorHub's
# test_every_exception_has_a_reason, which drew the line at 15 characters — long
# enough to defeat "n/a", "TODO", and "legacy".
MIN_REASON_LENGTH = 15

# Server-managed on essentially every table. Requiring each entity to list these
# would be pure noise, and noise is what stops people from declaring the ones that
# matter.
DEFAULT_SERVER_MANAGED = frozenset(
    {"created_at", "updated_at", "deleted_at"}
)

CLASSIFICATION_KINDS = frozenset(
    {
        # Client-written, but not user-AUTHORED: session envelopes, telemetry,
        # crash exhaust. Nobody loses a renovation budget because a chat-session
        # row drifted. The contract's cost outweighs its value — but say so out
        # loud, once, rather than leaving it unguarded and unexplained.
        "telemetry",
        # Has a client write surface, has NOT been audited, and everyone knows it.
        # A debt with a name on it, not a shrug. Must cite where the work is
        # tracked. This is not a place to park things forever.
        "triage",
    }
)


@dataclass(frozen=True)
class EntityOverride:
    """Per-entity declarations. Every reason here is mandatory."""

    #: Columns a client must never set. If a client could forge it, it is server-managed.
    server_managed: frozenset[str] = frozenset()
    #: Columns absent from the WRITE schemas on purpose. column -> reason.
    intentionally_absent: dict[str, str] = field(default_factory=dict)
    #: Fields on the write schemas that are NOT columns. field -> reason.
    non_column_fields: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Config:
    #: Modules to import so the ORM registry is populated. Without this there is
    #: no inventory — and an empty inventory reports a clean bill of health, which
    #: is the worst possible failure. See providers/base.py.
    models: tuple[str, ...] = ()
    #: Modules to scan for schema classes. NOT just `schemas/` — RE-InvestorHub
    #: keeps five entities' schemas in `routers/`, and an inventory that only
    #: looked in the obvious place under-reported by five.
    schemas: tuple[str, ...] = ()
    #: "app.main:app" — the ASGI app, for the authoritative route-table scan.
    app: str | None = None
    #: The committed API contract lockfile, e.g. "openapi.json". Relative to --root.
    #
    # This was missing entirely until 2.9.0 (#22). `cmd_openapi` read only
    # `args.lockfile`, so a config carrying `lockfile` was DECORATIVE — and the
    # failure mode was a rule insisting the lockfile was missing while the reader was
    # looking straight at it, then telling them to run `materialize`, which writes the
    # file that is then not read. False guidance on top of a false finding.
    #
    # The Node adapter always passes --lockfile explicitly, so this only ever bit
    # people driving gtl-contract directly — which, since 2.9.0, is a documented and
    # supported thing to do.
    lockfile: str | None = None

    #: Columns server-managed on EVERY entity.
    server_managed: frozenset[str] = DEFAULT_SERVER_MANAGED

    entities: dict[str, EntityOverride] = field(default_factory=dict)

    #: model -> (kind, reason). The narrow escape hatch for a model with a write
    #: surface that is deliberately not under contract.
    classifications: dict[str, tuple[str, str]] = field(default_factory=dict)

    #: Request bodies that follow no naming convention and cover no model. A
    #: RATCHET: it may shrink, never grow.
    unaudited_request_bodies: frozenset[str] = frozenset()

    def override_for(self, model_name: str) -> EntityOverride:
        return self.entities.get(model_name, EntityOverride())


def _entity_override(raw: dict[str, Any]) -> EntityOverride:
    return EntityOverride(
        server_managed=frozenset(raw.get("serverManaged") or raw.get("server_managed") or ()),
        intentionally_absent=dict(
            raw.get("intentionallyAbsent") or raw.get("intentionally_absent") or {}
        ),
        non_column_fields=dict(
            raw.get("nonColumnFields") or raw.get("non_column_fields") or {}
        ),
    )


def from_dict(raw: dict[str, Any] | None) -> Config:
    """Build a Config from the JSON the Node adapter hands us.

    The user authors `.gtl/config.js`; the Node side extracts its `contract` block
    and serializes it to JSON. Python never parses JavaScript.

    Both camelCase (as written in a .js config) and snake_case (as a Python user
    might expect) are accepted, because being strict about that would be a rule
    with no bug behind it.
    """
    raw = raw or {}

    classifications: dict[str, tuple[str, str]] = {}
    for name, value in (raw.get("classifications") or {}).items():
        if isinstance(value, dict):
            classifications[name] = (str(value.get("kind", "")), str(value.get("reason", "")))
        elif isinstance(value, (list, tuple)) and len(value) == 2:
            classifications[name] = (str(value[0]), str(value[1]))

    server_managed = raw.get("serverManaged") or raw.get("server_managed")

    return Config(
        models=tuple(raw.get("models") or ()),
        schemas=tuple(raw.get("schemas") or ()),
        app=raw.get("app"),
        lockfile=raw.get("lockfile"),
        server_managed=(
            frozenset(server_managed) if server_managed is not None else DEFAULT_SERVER_MANAGED
        ),
        entities={
            name: _entity_override(value or {})
            for name, value in (raw.get("entities") or {}).items()
        },
        classifications=classifications,
        unaudited_request_bodies=frozenset(
            raw.get("unauditedRequestBodies") or raw.get("unaudited_request_bodies") or ()
        ),
    )


def load(path: str | Path | None) -> Config:
    if not path:
        return Config()
    p = Path(path)
    if not p.exists():
        return Config()
    with p.open("r", encoding="utf-8") as fh:
        return from_dict(json.load(fh))
