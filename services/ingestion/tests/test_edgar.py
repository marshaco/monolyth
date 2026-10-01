import time
from datetime import date

import pytest

from monolyth_ingestion.config import ConfigError, sec_user_agent
from monolyth_ingestion.edgar import MAX_REQUESTS_PER_SECOND


def test_user_agent_required(monkeypatch):
    monkeypatch.delenv("SEC_USER_AGENT", raising=False)
    with pytest.raises(ConfigError):
        sec_user_agent()
    monkeypatch.setenv("SEC_USER_AGENT", "monolyth")  # no contact email
    with pytest.raises(ConfigError):
        sec_user_agent()
    monkeypatch.setenv("SEC_USER_AGENT", "monolyth admin@example.org")
    assert sec_user_agent() == "monolyth admin@example.org"


def test_sends_user_agent(edgar):
    fake, client = edgar
    client.company("AAPL")
    assert fake.requests[0].headers["User-Agent"] == "monolyth-tests test@example.org"


def test_company_lookup(edgar):
    _, client = edgar
    assert client.company("aapl").cik == 320193
    assert client.company("BRK.B").name == "BERKSHIRE HATHAWAY INC"  # dot → EDGAR's dash
    assert client.company("VOD.L") is None


def test_ticker_map_fetched_once(edgar):
    fake, client = edgar
    client.company("AAPL")
    client.company("MSFT")
    assert len(fake.requests) == 1


def test_recent_filings_filters_forms_and_date(edgar):
    _, client = edgar
    apple = client.company("AAPL")
    refs = client.recent_filings(apple, {"10-K", "10-Q", "8-K"}, since=date(2026, 1, 1))

    assert [(r.form, r.filed_on) for r in refs] == [("8-K", date(2026, 9, 2)), ("10-Q", date(2026, 8, 1))]
    q = refs[1]
    assert q.accession_number == "0000320193-26-000090"
    assert q.report_date == date(2026, 6, 28)
    assert q.document_url == "https://www.sec.gov/Archives/edgar/data/320193/000032019326000090/aapl-20260628.htm"
    assert refs[0].report_date == date(2026, 8, 30)


def test_rate_limited(edgar):
    _, client = edgar
    start = time.monotonic()
    for _ in range(4):
        client.document("https://www.sec.gov/Archives/edgar/data/320193/x/doc.htm")
    assert time.monotonic() - start >= 3 / MAX_REQUESTS_PER_SECOND * 0.95
