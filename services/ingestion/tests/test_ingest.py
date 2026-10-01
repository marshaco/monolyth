from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from monolyth_db import Filing, get_engine
from monolyth_ingestion.ingest import ingest_filings

pytestmark = pytest.mark.usefixtures("clean_filings")
SINCE = date(2026, 1, 1)


def stored(session):
    return {f.accession_number: f for f in session.scalars(select(Filing))}


def test_ingests_new_filings_with_text(edgar):
    _, client = edgar
    with Session(get_engine()) as session:
        result = ingest_filings(session, client, ["AAPL"], since=SINCE)
        filings = stored(session)

    assert sorted(result.new) == ["0000320193-26-000090", "0000320193-26-000099"]
    assert sorted(result.parsed) == sorted(result.new)
    q = filings["0000320193-26-000090"]
    assert (q.ticker, q.cik, q.company_name, q.form) == ("AAPL", 320193, "Apple Inc.", "10-Q")
    assert "net sales of 94,036 million" in q.text
    assert q.parsed_at is not None


def test_second_run_is_a_no_op(edgar):
    fake, client = edgar
    with Session(get_engine()) as session:
        ingest_filings(session, client, ["AAPL"], since=SINCE)
        documents_before = sum("/Archives/" in str(r.url) for r in fake.requests)
        result = ingest_filings(session, client, ["AAPL"], since=SINCE)

    assert result.new == [] and result.parsed == []
    assert sum("/Archives/" in str(r.url) for r in fake.requests) == documents_before


def test_unknown_ticker_reported(edgar):
    _, client = edgar
    with Session(get_engine()) as session:
        result = ingest_filings(session, client, ["VOD.L"], since=SINCE)
    assert result.unknown_tickers == ["VOD.L"] and result.new == []


def test_failed_document_fetch_is_retried_next_run(edgar):
    fake, client = edgar
    fake.fail_documents = True
    with Session(get_engine()) as session:
        first = ingest_filings(session, client, ["AAPL"], since=SINCE)
        assert len(first.new) == 2 and first.parsed == [] and len(first.errors) == 2
        assert all(f.text is None for f in stored(session).values())

        fake.fail_documents = False
        second = ingest_filings(session, client, ["AAPL"], since=SINCE)
        assert second.new == [] and len(second.parsed) == 2


def test_8k_text_includes_ex99_exhibits(edgar):
    fake, client = edgar
    with Session(get_engine()) as session:
        ingest_filings(session, client, ["AAPL"], since=SINCE)
        text = stored(session)["0000320193-26-000099"].text

    assert text.splitlines() == [
        "Item 2.02 Results of Operations and Financial Condition.",
        "See Exhibit 99.1.",
        "",
        "Exhibit 99.1: PRESS RELEASE",
        "Apple reports fourth quarter results",
        "Revenue of $102.5 billion, up 6 percent year over year.",
        "",
        "Exhibit 99.2",
        "Apple reports fourth quarter results",
        "Revenue of $102.5 billion, up 6 percent year over year.",
    ]
    urls = [str(r.url) for r in fake.requests]
    assert not any(u.endswith("a8-kex101.htm") for u in urls)  # EX-10.1 isn't fetched


def test_10q_does_not_fetch_the_filing_index(edgar):
    fake, client = edgar
    with Session(get_engine()) as session:
        ingest_filings(session, client, ["AAPL"], since=SINCE)
    index_requests = [str(r.url) for r in fake.requests if str(r.url).endswith("-index.htm")]
    assert index_requests == [
        "https://www.sec.gov/Archives/edgar/data/320193/000032019326000099/0000320193-26-000099-index.htm"
    ]
