import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from auth import CurrentUser, DbSession
from monolyth_db import Filing, Holding

router = APIRouter(prefix="/filings", tags=["filings"])


class FilingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ticker: str
    company_name: str
    form: str
    filed_on: date
    report_date: date | None
    document_url: str
    summary_headline: str | None
    summary: str | None


@router.get("")
def list_filings(
    user: CurrentUser,
    session: DbSession,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    summarized_only: bool = True,
) -> list[FilingOut]:
    """Recent filings for companies the current user holds, newest first. By default only
    filings that already have a summary, since those are the ones worth showing."""
    held = select(Holding.ticker).where(Holding.user_id == user.id)
    query = select(Filing).where(Filing.ticker.in_(held))
    if summarized_only:
        query = query.where(Filing.summary.is_not(None))
    rows = session.scalars(query.order_by(Filing.filed_on.desc(), Filing.created_at.desc()).limit(limit))
    return [FilingOut.model_validate(f) for f in rows]
