from datetime import date

import pytest
from sqlalchemy.orm import Session

from main import app
from monolyth_db import Filing, get_engine
from monolyth_intelligence.embed import embed_pending
from monolyth_intelligence.testing import FakeOpenAI
from routers.search import openai_client


@pytest.fixture
def fake_openai():
    fake = FakeOpenAI()
    app.dependency_overrides[openai_client] = fake.client
    yield fake
    app.dependency_overrides.pop(openai_client, None)


def add_embedded_filing(fake, accession, ticker, text):
    with Session(get_engine()) as session:
        session.add(
            Filing(
                accession_number=accession, ticker=ticker, cik=1, company_name=f"{ticker} Inc.", form="10-K",
                filed_on=date(2026, 9, 1), document_url=f"https://www.sec.gov/{accession}.htm", text=text,
            )
        )
        session.commit()
        embed_pending(session, fake.client())


def test_search_returns_relevant_passages_from_held_companies(client, fake_openai):
    client.post("/v1/holdings", json={"ticker": "AAPL"})
    client.post("/v1/holdings", json={"ticker": "NVDA"})
    add_embedded_filing(fake_openai, "a", "AAPL", "Gross margin pressure rose because of tariffs on components.")
    add_embedded_filing(fake_openai, "n", "NVDA", "Data center revenue doubled.")
    add_embedded_filing(fake_openai, "m", "MSFT", "Margin pressure from tariffs.")  # not held

    res = client.get("/v1/search", params={"q": "margin pressure tariffs", "k": 5})
    assert res.status_code == 200
    hits = res.json()
    assert hits[0]["ticker"] == "AAPL" and "margin pressure" in hits[0]["text"].lower()
    assert {h["ticker"] for h in hits} <= {"AAPL", "NVDA"}
    assert set(hits[0]) == {"ticker", "company_name", "form", "filed_on", "document_url", "text", "score"}


def test_no_holdings_returns_nothing(client, fake_openai):
    assert client.get("/v1/search", params={"q": "anything"}).json() == []
    assert fake_openai.batches == []  # no embedding call for nothing to search


def test_query_validation(client, fake_openai):
    assert client.get("/v1/search").status_code == 422
    assert client.get("/v1/search", params={"q": "x"}).status_code == 422
    assert client.get("/v1/search", params={"q": "ok query", "k": 26}).status_code == 422


def test_unconfigured_search_is_503(client, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    res = client.get("/v1/search", params={"q": "margin"})
    assert res.status_code == 503 and "OPENAI_API_KEY" in res.json()["detail"]
