import uuid
from datetime import date, datetime
from decimal import Decimal

from pgvector.sqlalchemy import Vector
from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, Text, UniqueConstraint, func
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


class Filing(TimestampMixin, Base):
    """A company filing (SEC 10-K/10-Q/8-K today; UK RNS later). Keyed by ticker rather than
    linked to holdings, since one filing matters to every user who holds the company."""

    __tablename__ = "filings"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # SEC accession number (e.g. "0000320193-24-000123"), unique across all of EDGAR
    accession_number: Mapped[str] = mapped_column(String(32), unique=True)
    ticker: Mapped[str] = mapped_column(String(16), index=True)
    cik: Mapped[int]
    company_name: Mapped[str] = mapped_column(String(255))
    form: Mapped[str] = mapped_column(String(16))
    filed_on: Mapped[date] = mapped_column(Date, index=True)
    report_date: Mapped[date | None] = mapped_column(Date)
    document_url: Mapped[str] = mapped_column(String(512))
    description: Mapped[str | None] = mapped_column(String(255))
    # Plain text of the primary document; null until fetched and parsed
    text: Mapped[str | None] = mapped_column(Text)
    parsed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Plain-English summary for retail investors (services/intelligence); null until summarised
    summary_headline: Mapped[str | None] = mapped_column(String(255))
    summary: Mapped[str | None] = mapped_column(Text)
    summary_model: Mapped[str | None] = mapped_column(String(64))
    summarized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set when a filing can't be summarised (e.g. over the size limit), so it isn't retried every run
    summary_error: Mapped[str | None] = mapped_column(String(255))


# OpenAI text-embedding-3-small (CLAUDE.md); changing model or dimensions needs a migration and re-embed
EMBEDDING_DIMENSIONS = 1536


class FilingChunk(Base):
    """A passage of a filing with its embedding, for semantic search across holdings' filings
    ("what have my holdings said about margin pressure?")."""

    __tablename__ = "filing_chunks"
    __table_args__ = (
        UniqueConstraint("filing_id", "chunk_index"),
        Index(
            "ix_filing_chunks_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    filing_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("filings.id", ondelete="CASCADE"), index=True)
    chunk_index: Mapped[int]
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBEDDING_DIMENSIONS))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    filing: Mapped[Filing] = relationship()


class ArticleEngagement(Base):
    """One user interaction with a news article (currently: opening it). Raw events; affinities
    are computed from them with time decay, so preferences can shift (#10)."""

    __tablename__ = "article_engagement"
    __table_args__ = (Index("ix_article_engagement_user_created", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16), default="click")
    article_url: Mapped[str] = mapped_column(String(2048))
    # Registrable domain (outletKey in apps/web/lib/feed-ranking.ts), e.g. "yahoo.com"
    outlet: Mapped[str] = mapped_column(String(255))
    ticker: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
