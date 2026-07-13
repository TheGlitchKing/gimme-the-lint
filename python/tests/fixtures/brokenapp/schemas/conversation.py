"""Conversation schemas — the #998A bug, preserved."""

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict


class ConversationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    meta_config: Optional[dict[str, Any]] = None


class ConversationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Optional[str] = None
    meta_config: Optional[dict[str, Any]] = None


class ConversationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    conversation_id: str
    title: Optional[str] = None

    # #998A, THE bug. `metadata` is reserved on every SQLAlchemy declarative model:
    # Base.metadata IS the MetaData registry, so hasattr(Model, "metadata") is
    # always True. With from_attributes, this field reads the REGISTRY rather than
    # a column, and Pydantic blows up with "Input should be a valid dictionary
    # [input_value=MetaData()]".
    #
    # Result: GET and PUT returned 500 for every conversation, forever. It needed a
    # validation_alias pointing at the real column (`meta_config`). It has none.
    # -> contract/reserved-metadata-unaliased
    metadata: Optional[dict[str, Any]] = None
