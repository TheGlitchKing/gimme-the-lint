"""The provider registry.

Adding a stack (Django+DRF, Prisma+zod, TypeORM+class-validator) means adding one
entry here and one module beside it. Nothing else in gtl-contract changes — the
same deliberate constraint the Node engine puts on its adapter registry.
"""

from __future__ import annotations

from ..config import Config
from .base import Provider, ProviderResult
from .sqlalchemy_pydantic import SqlAlchemyPydanticProvider

REGISTRY: dict[str, type] = {
    SqlAlchemyPydanticProvider.id: SqlAlchemyPydanticProvider,
}


def get(provider_id: str) -> Provider:
    try:
        return REGISTRY[provider_id]()
    except KeyError:
        raise KeyError(
            f"Unknown provider {provider_id!r}. Known: {', '.join(sorted(REGISTRY))}"
        ) from None


def detect(root: str, config: Config) -> Provider | None:
    """The first provider that recognizes this project, or None."""
    for cls in REGISTRY.values():
        provider = cls()
        if provider.detect(root, config):
            return provider
    return None


__all__ = ["Provider", "ProviderResult", "REGISTRY", "get", "detect"]
