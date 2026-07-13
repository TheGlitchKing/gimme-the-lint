"""Deal schemas — the #974 bugs, preserved."""

from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator


class DealCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    purchase_price: float
    # `operating_expenses` is missing. That is the bug: the column exists, the user
    # fills it in, the API answers 201, and the value goes in the bin.
    # -> contract/column-not-writable


class DealUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = None
    # `purchase_price` is settable on create but not changeable here, and nobody
    # declared that as deliberate. -> contract/create-update-disagree


class DealResponse(BaseModel):
    deal_id: str
    name: Optional[str] = None
    purchase_price: Optional[float] = None

    # #974: the column is JSON. Typing it `str` is a landmine with a fuse — the
    # first correct value written to it 500s every read.
    # -> contract/response-type-mismatch
    units_details: Optional[str] = None

    # A write-side coercer on the READ path. One legacy row the database already
    # contains can now 500 the endpoint returning it.
    # -> contract/response-inherits-write-validator
    @field_validator("name")
    @classmethod
    def _validate_name(cls, v):
        if v is not None and len(v) < 3:
            raise ValueError("too short")
        return v


class DocumentResponse(BaseModel):
    """One half of the duplicate. See schemas/document.py for the other.

    The two have DIFFERENT fields, so which document shape a client gets depends on
    which endpoint it happens to hit. -> contract/duplicate-schema-class-drifted
    """

    document_id: str
    filename: str
