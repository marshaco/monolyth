from datetime import date

from sqlalchemy.orm import Session

from monolyth_db import Filing, get_engine


def add_filing(accession, ticker, filed_on, summary="Summary.", headline="Headline"):
    with Session(get_engine()) as session:
        session.add(
            Filing(
                accession_number=accession,
                ticker=ticker,
                cik=1,
                company_name=f"{ticker} Inc.",
                form="10-Q",
                filed_on=filed_on,
                document_url=f"https://www.sec.gov/{accession}.htm",
                text="...",
                summary=summary,
                summary_headline=headline if summary else None,
            )
        )
        session.commit()


def test_only_filings_for_held_tickers_newest_first(client):
    client.post("/v1/holdings", json={"ticker": "AAPL"})
    client.post("/v1/holdings", json={"ticker": "NVDA"})
    add_filing("a-old", "AAPL", date(2026, 7, 1))
    add_filing("a-new", "AAPL", date(2026, 9, 1))
    add_filing("n-mid", "NVDA", date(2026, 8, 1))
    add_filing("m", "MSFT", date(2026, 9, 15))  # not held

    res = client.get("/v1/filings")
    assert res.status_code == 200
    assert [f["ticker"] + ":" + f["filed_on"] for f in res.json()] == [
        "AAPL:2026-09-01",
        "NVDA:2026-08-01",
        "AAPL:2026-07-01",
    ]
    first = res.json()[0]
    assert first["summary_headline"] == "Headline" and first["company_name"] == "AAPL Inc."
    assert "text" not in first  # full filing text isn't sent to the browser


def test_unsummarized_hidden_by_default(client):
    client.post("/v1/holdings", json={"ticker": "AAPL"})
    add_filing("done", "AAPL", date(2026, 9, 1))
    add_filing("pending", "AAPL", date(2026, 9, 2), summary=None)

    assert [f["filed_on"] for f in client.get("/v1/filings").json()] == ["2026-09-01"]
    assert len(client.get("/v1/filings?summarized_only=false").json()) == 2


def test_limit(client):
    client.post("/v1/holdings", json={"ticker": "AAPL"})
    for day in range(1, 6):
        add_filing(f"f{day}", "AAPL", date(2026, 9, day))
    assert len(client.get("/v1/filings?limit=2").json()) == 2
    assert client.get("/v1/filings?limit=0").status_code == 422
    assert client.get("/v1/filings?limit=101").status_code == 422


def test_no_holdings_no_filings(client):
    add_filing("a", "AAPL", date(2026, 9, 1))
    assert client.get("/v1/filings").json() == []
