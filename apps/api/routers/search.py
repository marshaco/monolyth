from typing import Annotated

import openai
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select

from auth import CurrentUser, DbSession
from monolyth_db import Holding
from monolyth_intelligence.embed import has_openai_key, search_filings

router = APIRouter(prefix="/search", tags=["search"])


def openai_client() -> openai.OpenAI:
    if not has_openai_key():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Search isn't configured (OPENAI_API_KEY not set)")
    return openai.OpenAI()


class SearchHitOut(BaseModel):
    ticker: str
    company_name: str
    form: str
    filed_on: str
    document_url: str
    text: str
    score: float


@router.get("")
def search(
    user: CurrentUser,
    session: DbSession,
    client: Annotated[openai.OpenAI, Depends(openai_client)],
    q: Annotated[str, Query(min_length=2, max_length=500)],
    k: Annotated[int, Query(ge=1, le=25)] = 8,
) -> list[SearchHitOut]:
    """Passages from the current user's holdings' filings most relevant to `q`,
    e.g. "what have my holdings said about margin pressure?"."""
    tickers = list(session.scalars(select(Holding.ticker).where(Holding.user_id == user.id)))
    hits = search_filings(session, client, q, tickers, k)
    return [SearchHitOut(**hit.__dict__) for hit in hits]
