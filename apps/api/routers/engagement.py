import time
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
# Platform trust: an outlet needs this many distinct readers before it gets any trust score,
# so a handful of users (or one determined one) can't move everyone's feed
MIN_TRUST_USERS = 5
# Trust is recomputed at most this often per API process; it moves slowly by design
TRUST_CACHE_SECONDS = 3600

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


class OutletTrust(BaseModel):
    # Distinct users with any engagement in the window
    users: int
    min_users: int
    # Outlets read by at least `min_users` people, scaled so the most trusted is 1.0
    outlets: dict[str, float]


_trust_cache: tuple[float, OutletTrust] | None = None


def compute_outlet_trust(session, now: datetime | None = None) -> OutletTrust:
    """Platform-wide outlet trust from everyone's decayed clicks (#13).

    Each user gets exactly one vote, split across outlets in proportion to their own decayed
    clicks. So heavy clickers count the same as light ones, and click floods only redistribute
    one person's vote. Outlets read by fewer than MIN_TRUST_USERS people get no score."""
    now = now or datetime.now(UTC)
    rows = session.execute(
        select(ArticleEngagement.user_id, ArticleEngagement.outlet, ArticleEngagement.created_at).where(
            ArticleEngagement.created_at >= now - timedelta(days=WINDOW_DAYS)
        )
    ).all()

    per_user: dict = defaultdict(lambda: defaultdict(float))
    for user_id, outlet, created_at in rows:
        per_user[user_id][outlet] += 0.5 ** ((now - created_at).total_seconds() / 86400 / HALF_LIFE_DAYS)

    votes: dict[str, float] = defaultdict(float)
    readers: dict[str, int] = defaultdict(int)
    for outlets in per_user.values():
        total = sum(outlets.values())
        for outlet, weight in outlets.items():
            votes[outlet] += weight / total
            readers[outlet] += 1

    eligible = {o: v for o, v in votes.items() if readers[o] >= MIN_TRUST_USERS}
    return OutletTrust(users=len(per_user), min_users=MIN_TRUST_USERS, outlets=_scaled(eligible))


@router.get("/outlet-trust")
def outlet_trust(user: CurrentUser, session: DbSession) -> OutletTrust:
    """Platform-wide outlet trust, cached per process for TRUST_CACHE_SECONDS."""
    global _trust_cache
    if _trust_cache is None or time.monotonic() - _trust_cache[0] > TRUST_CACHE_SECONDS:
        _trust_cache = (time.monotonic(), compute_outlet_trust(session))
    return _trust_cache[1]
