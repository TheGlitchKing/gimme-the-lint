"""The provider contract.

A PROVIDER binds one persistence layer to one transport layer:

    sqlalchemy + pydantic   (FastAPI)      <- shipped
    django     + drf
    prisma     + zod
    typeorm    + class-validator

The generic shape they all share is **persistence model <-> transport schemas**:
a table, and the Create/Update/Response objects that expose it. The rules are
mostly about their agreement, and mostly portable. A few are not — the
`metadata` / `Base.metadata` collision is purely SQLAlchemy — and that is fine.
Rules belong to the provider, exactly as ESLint's rules belong to ESLint. The
engine only ever sees violations.

## Skipping is not passing

The single most dangerous outcome in this file is a provider that cannot see the
application and returns zero violations. Zero violations reads as "clean". A guard
that reports green while guarding nothing is precisely the failure this entire
tool exists to eliminate, so it must not be how the tool itself fails.

Hence `ProviderResult` distinguishes:

    checked=True,  violations=[]  -> genuinely clean. Say so.
    checked=False, skip="..."     -> we could not look. Say THAT, loudly.

The engine maps the second onto its idempotent-skip contract: warn, never block.
A skip is an admission of ignorance, and it must never be laundered into a pass.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from ..config import Config
from ..violation import Violation


@dataclass(frozen=True)
class ProviderResult:
    #: False when we could not inspect the app at all (libraries absent, import
    #: blew up, no models found). NOT the same as "no violations".
    checked: bool
    violations: list[Violation] = field(default_factory=list)
    #: Human-readable reason we could not check. Required when checked is False.
    skip: str | None = None
    #: Detail for the reader — usually an import traceback. The engine prints it,
    #: because "the contract check was skipped" with no cause is unactionable.
    detail: str | None = None

    @staticmethod
    def skipped(reason: str, detail: str | None = None) -> "ProviderResult":
        return ProviderResult(checked=False, violations=[], skip=reason, detail=detail)

    @staticmethod
    def ok(violations: list[Violation]) -> "ProviderResult":
        return ProviderResult(checked=True, violations=violations)


class Provider(Protocol):
    id: str

    def detect(self, root: str, config: Config) -> bool:
        """Is this stack even present? Cheap, no imports of the app itself."""
        ...

    def check(self, root: str, config: Config) -> ProviderResult:
        """Inspect the app and return findings, or explain why we could not."""
        ...
