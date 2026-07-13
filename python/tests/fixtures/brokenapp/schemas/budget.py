"""Budget schemas — the #998B bug, preserved."""

from typing import Optional

from pydantic import BaseModel, ConfigDict


class BudgetLineItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = "pending"  # fine HERE: a default on create is just a default
    notes: Optional[str] = None
    amount: float


class BudgetLineItemUpdate(BaseModel):
    # No extra='forbid'. An unknown key is accepted, discarded, and the request
    # still succeeds — the mechanism behind every other bug in this fixture.
    # -> contract/write-schema-not-strict

    # #998B, THE bug: an update schema is applied OVER a stored row. A client that
    # omits `status` gets this default written over whatever was there. Opening a
    # project and clicking Save reset every approved line item back to pending and
    # wiped its notes. The user changed nothing. It returned 200.
    # -> contract/update-has-create-default
    status: str = "pending"
    notes: Optional[str] = None
    amount: Optional[float] = None


class BudgetLineItemResponse(BaseModel):
    line_item_id: str
    status: Optional[str] = None
    notes: Optional[str] = None
    amount: Optional[float] = None
