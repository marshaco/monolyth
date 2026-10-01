from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from monolyth_db import ArticleEngagement, User, get_engine
from routers.engagement import HALF_LIFE_DAYS


def click(client, outlet, ticker, url="https://example.com/a"):
    return client.post("/v1/engagement", json={"article_url": url, "outlet": outlet, "ticker": ticker})


def age_all_events(days):
    with Session(get_engine()) as s:
        s.execute(update(ArticleEngagement).values(created_at=datetime.now(UTC) - timedelta(days=days)))
        s.commit()


def test_records_a_click(client):
    assert click(client, " Fool.com ", "nvda").status_code == 204
    with Session(get_engine()) as s:
        event = s.scalar(select(ArticleEngagement))
        user = s.scalar(select(User))
    assert (event.outlet, event.ticker, event.kind, event.user_id) == ("fool.com", "NVDA", "click", user.id)


def test_rejects_bad_input(client):
    assert click(client, "fool.com", "NVDA", url="javascript:alert(1)").status_code == 422
    assert click(client, "", "NVDA").status_code == 422
    assert click(client, "fool.com", "not a ticker").status_code == 422


def test_cold_start_is_not_personalised(client):
    for _ in range(4):
        click(client, "fool.com", "NVDA")
    a = client.get("/v1/engagement/affinity").json()
    assert a["events"] == 4 and a["personalised"] is False


def test_affinity_scaled_to_strongest(client):
    for _ in range(6):
        click(client, "fool.com", "NVDA")
    for _ in range(3):
        click(client, "zacks.com", "AAPL")
    a = client.get("/v1/engagement/affinity").json()
    assert a["personalised"] is True and a["events"] == 9
    assert a["outlets"] == {"fool.com": 1.0, "zacks.com": 0.5}
    assert a["tickers"] == {"NVDA": 1.0, "AAPL": 0.5}


def test_old_clicks_decay(client):
    for _ in range(6):
        click(client, "fool.com", "NVDA")
    age_all_events(HALF_LIFE_DAYS * 2)  # each now weighs 0.25 → 1.5 total
    for _ in range(3):
        click(client, "zacks.com", "AAPL")  # fresh: 3.0 total
    a = client.get("/v1/engagement/affinity").json()
    assert a["outlets"]["zacks.com"] == 1.0
    assert abs(a["outlets"]["fool.com"] - 0.5) < 0.01


def test_events_outside_window_ignored(client):
    for _ in range(6):
        click(client, "fool.com", "NVDA")
    age_all_events(91)
    a = client.get("/v1/engagement/affinity").json()
    assert a == {"events": 0, "half_life_days": HALF_LIFE_DAYS, "personalised": False, "outlets": {}, "tickers": {}}


# --- platform-wide outlet trust (#13) ---

from routers import engagement as engagement_router  # noqa: E402
from routers.engagement import MIN_TRUST_USERS, compute_outlet_trust  # noqa: E402


def add_users_reading(clicks_by_user: list[dict[str, int]]):
    with Session(get_engine()) as s:
        for i, clicks in enumerate(clicks_by_user):
            user = User(clerk_user_id=f"trust_user_{i}")
            s.add(user)
            s.flush()
            for outlet, n in clicks.items():
                s.add_all(
                    ArticleEngagement(user_id=user.id, article_url="https://x.com/a", outlet=outlet, ticker="AAPL")
                    for _ in range(n)
                )
        s.commit()


def trust():
    with Session(get_engine()) as s:
        return compute_outlet_trust(s)


def test_no_trust_until_enough_distinct_readers():
    add_users_reading([{"reuters.com": 3}] * (MIN_TRUST_USERS - 1))
    t = trust()
    assert t.users == MIN_TRUST_USERS - 1 and t.outlets == {}


def test_outlets_scored_by_share_of_readers_votes():
    # 6 users split between reuters and fool; reuters gets most of each vote
    add_users_reading([{"reuters.com": 3, "fool.com": 1}] * 6)
    t = trust()
    assert t.outlets == {"reuters.com": 1.0, "fool.com": round(0.25 / 0.75, 4)}


def test_one_heavy_clicker_cannot_dominate():
    # 5 ordinary readers of reuters, plus one user hammering fool.com 1,000 times
    add_users_reading([{"reuters.com": 1, "fool.com": 1}] * 5 + [{"fool.com": 1000}])
    t = trust()
    # fool.com: 5 × 0.5 + 1 vote = 3.5 ; reuters: 5 × 0.5 = 2.5 → the flood counts as just one vote
    assert t.outlets["fool.com"] == 1.0 and t.outlets["reuters.com"] == round(2.5 / 3.5, 4)


def test_outlet_needs_min_readers_even_with_many_clicks():
    add_users_reading([{"reuters.com": 1}] * MIN_TRUST_USERS + [{"tiny.blog": 500}])
    assert "tiny.blog" not in trust().outlets


def test_endpoint_is_cached(client, monkeypatch):
    monkeypatch.setattr(engagement_router, "_trust_cache", None)
    first = client.get("/v1/engagement/outlet-trust").json()
    add_users_reading([{"reuters.com": 1}] * MIN_TRUST_USERS)
    assert client.get("/v1/engagement/outlet-trust").json() == first  # served from cache
    monkeypatch.setattr(engagement_router, "_trust_cache", None)
    assert client.get("/v1/engagement/outlet-trust").json()["outlets"] == {"reuters.com": 1.0}
