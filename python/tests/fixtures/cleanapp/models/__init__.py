"""The same shapes as brokenapp, with every bug fixed.

This fixture exists to prove the INVERSE of every rule: that each one can actually
be satisfied. A rule that fires on correct code is a rule people turn off, and a
disabled rule guards nothing — so "it catches the bug" is only half a test. The
other half is "and it shuts up when you fix it."
"""

from sqlalchemy import JSON, Column, DateTime, Float, Integer, String
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class Deal(Base):
    __tablename__ = "deals"

    deal_id = Column(String, primary_key=True)  # derived server-managed: no config needed
    created_at = Column(DateTime)
    updated_at = Column(DateTime)

    name = Column(String)
    purchase_price = Column(Float)
    operating_expenses = Column(Float)
    units_details = Column(JSON)


class Conversation(Base):
    __tablename__ = "conversations"

    conversation_id = Column(String, primary_key=True)
    title = Column(String)
    meta_config = Column(JSON)


class BudgetLineItem(Base):
    __tablename__ = "budget_line_items"

    line_item_id = Column(String, primary_key=True)
    status = Column(String)
    notes = Column(String)
    amount = Column(Float)


class AuditLog(Base):
    """Server-only. No schemas, no config, no violations. Costs nobody anything."""

    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True)
    action = Column(String)
