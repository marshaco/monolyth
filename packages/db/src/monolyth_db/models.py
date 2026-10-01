import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Clerk's user id (e.g. "user_2abc..."); the only link to the auth provider
    clerk_user_id: Mapped[str] = mapped_column(String(64), unique=True)
    email: Mapped[str | None] = mapped_column(String(320))

    holdings: Mapped[list["Holding"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Holding(TimestampMixin, Base):
    """A position in the unified schema from CLAUDE.md. Quantity and cost are optional
    so a holding can be a bare ticker until a brokerage sync fills them in."""

    __tablename__ = "holdings"
    __table_args__ = (UniqueConstraint("user_id", "ticker", "brokerage"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    ticker: Mapped[str] = mapped_column(String(16))
    name: Mapped[str | None] = mapped_column(String(255))
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    avg_cost: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    # "manual" for tickers typed into the UI; otherwise the brokerage it was synced from
    brokerage: Mapped[str] = mapped_column(String(32), default="manual")

    user: Mapped[User] = relationship(back_populates="holdings")
