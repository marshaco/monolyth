from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, status
from pydantic import AnyHttpUrl, BaseModel, StringConstraints
from sqlalchemy import select

from auth import CurrentUser, DbSession
from monolyth_db import ArticleEngagement
from routers.holdings import Ticker

router = APIRouter(prefix="/engagement", tags=["engagement"])

# An event's weight halves every HALF_LIFE_DAYS, so preferences can shift over time
HALF_LIFE_DAYS = 14
# Older events contribute < 1% (0.5^(90/14)) and are ignored
WINDOW_DAYS = 90
# Below this many (decayed) events there's too little signal to personalise on
MIN_EVENTS = 5

Outlet = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, min_length=1, max_length=255)]


class EngagementIn(BaseModel):
    article_url: AnyHttpUrl
    outlet: Outlet
    ticker: Ticker


class Affinity(BaseModel):
    events: int
    half_life_days: int
    # True when there's enough history to personalise; otherwise clients should use the baseline feed
    personalised: bool
    # Decayed engagement per outlet / ticker, scaled so the strongest is 1.0
    outlets: dict[str, float]
    tickers: dict[str, float]


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
def record(body: EngagementIn, user: CurrentUser, session: DbSession) -> None:
    session.add(
        ArticleEngagement(
            user_id=user.id, kind="click", article_url=str(body.article_url), outlet=body.outlet, ticker=body.ticker
        )
    )
    session.commit()


def _scaled(scores: dict[str, float]) -> dict[str, float]:
    top = max(scores.values(), default=0)
    return {k: round(v / top, 4) for k, v in sorted(scores.items(), key=lambda kv: -kv[1])} if top else {}


@router.get("/affinity")
def affinity(user: CurrentUser, session: DbSession) -> Affinity:
    """The current user's outlet and ticker preferences, from time-decayed clicks.
    Also serves as the debugging view of what personalisation is acting on."""
    now = datetime.now(UTC)
    rows = session.execute(
        select(ArticleEngagement.outlet, ArticleEngagement.ticker, ArticleEngagement.created_at).where(
            ArticleEngagement.user_id == user.id,
            ArticleEngagement.created_at >= now - timedelta(days=WINDOW_DAYS),
        )
    ).all()

    outlets: dict[str, float] = defaultdict(float)
    tickers: dict[str, float] = defaultdict(float)
    total = 0.0
    for outlet, ticker, created_at in rows:
        weight = 0.5 ** ((now - created_at).total_seconds() / 86400 / HALF_LIFE_DAYS)
        outlets[outlet] += weight
        tickers[ticker] += weight
        total += weight

    return Affinity(
        events=len(rows),
        half_life_days=HALF_LIFE_DAYS,
        personalised=total >= MIN_EVENTS,
        outlets=_scaled(outlets),
        tickers=_scaled(tickers),
    )
