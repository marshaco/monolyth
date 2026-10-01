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
