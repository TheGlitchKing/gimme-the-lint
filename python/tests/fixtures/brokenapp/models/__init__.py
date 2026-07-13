"""Models for the broken fixture app.

Each model here reproduces a real, shipped production bug. The rule that catches it
is named in the comment. If you "fix" a model in this file, you disarm a test.
"""

from sqlalchemy import JSON, Column, DateTime, Float, Integer, String
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class Deal(Base):
    __tablename__ = "deals"

    deal_id = Column(String, primary_key=True)
    created_at = Column(DateTime)  # universally server-managed; must not be reported
    updated_at = Column(DateTime)

    name = Column(String)
    purchase_price = Column(Float)

    # #974: declared on no write schema. A client sends it, gets a 201, and the
    # value is silently dropped. -> contract/column-not-writable
    operating_expenses = Column(Float)

    # Returned by no response schema. No client can ever read it.
    # -> contract/column-not-readable
    internal_score = Column(Float)

    # #974: a JSON column that DealResponse types as `str`. Harmless until someone
    # writes correct data into it, then every read 500s.
    # -> contract/response-type-mismatch
    units_details = Column(JSON)


class Conversation(Base):
    __tablename__ = "conversations"

    conversation_id = Column(String, primary_key=True)
    title = Column(String)

    # #998A: the column CANNOT be called `metadata` — that name is reserved on every
    # declarative model (Base.metadata is the MetaData registry). So it is stored
    # under a real name, and the response is supposed to alias onto it. The broken
    # ConversationResponse does not. -> contract/reserved-metadata-unaliased
    meta_config = Column(JSON)


class BudgetLineItem(Base):
    __tablename__ = "budget_line_items"

    line_item_id = Column(String, primary_key=True)
    status = Column(String)
    notes = Column(String)
    amount = Column(Float)


class Organization(Base):
    __tablename__ = "organizations"

    org_id = Column(String, primary_key=True)
    tier = Column(String)


class AuditLog(Base):
    """No schemas anywhere -> no client write surface -> nothing can drift.

    This model exists to prove a NEGATIVE: it must produce zero violations and
    require zero configuration. A new server-only table (an audit log, a queue, an
    ETL watermark) must cost nobody a line of config, or people will stop adding
    tables — or worse, stop running the checker.
    """

    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True)
    action = Column(String)
