"""Correct schemas. Every rule in the checker is satisfied by this file."""

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

# --- Deal: every column writable, readable, and correctly typed ------------------


class DealCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")  # unknown key -> loud 422, never a silent drop

    name: str
    purchase_price: float
    operating_expenses: Optional[float] = None  # the #974 column, now accepted
    units_details: Optional[list[dict[str, Any]]] = None


class DealUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Same fields as Create — a field you can set but never change is drift.
    # Every default is None: `exclude_unset` then distinguishes "not sent" from
    # "explicitly null", so an untouched field is never written over stored data.
    name: Optional[str] = None
    purchase_price: Optional[float] = None
    operating_expenses: Optional[float] = None
    units_details: Optional[list[dict[str, Any]]] = None


class DealResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    deal_id: str
    name: Optional[str] = None
    purchase_price: Optional[float] = None
    operating_expenses: Optional[float] = None
    # Typed to match the JSON column, not `str`. No landmine.
    units_details: Optional[list[dict[str, Any]]] = None
    # No inherited write validators: the read path never rejects data the database
    # already contains.


# --- Conversation: the reserved-name bridge, done correctly ----------------------


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
    # The bridge: the wire name is `metadata`, the column is `meta_config`. The
    # column CANNOT be called `metadata` (reserved), so the alias is the only
    # correct way to expose it — and it must point at a real column.
    metadata: Optional[dict[str, Any]] = Field(default=None, validation_alias="meta_config")


# --- BudgetLineItem: defaults on create only -------------------------------------


class BudgetLineItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = "pending"  # a default on CREATE is just a default
    notes: Optional[str] = None
    amount: float


class BudgetLineItemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # No non-None defaults. An update schema is applied OVER a stored row, so a
    # default here would be written on top of the user's data the moment they
    # omitted the field. This is the #998B fix.
    status: Optional[str] = None
    notes: Optional[str] = None
    amount: Optional[float] = None


class BudgetLineItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    line_item_id: str
    status: Optional[str] = None
    notes: Optional[str] = None
    amount: Optional[float] = None
