import json
from pathlib import Path

import httpx2
import pytest
from sqlalchemy import text

from monolyth_db import get_engine
from monolyth_ingestion.edgar import EdgarClient

FIXTURES = Path(__file__).parent / "fixtures"
USER_AGENT = "monolyth-tests test@example.org"


class FakeEdgar:
    """Serves fixture files for EDGAR URLs and records every request."""

    def __init__(self):
        self.requests: list[httpx2.Request] = []
        self.fail_documents = False

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        url = str(request.url)
        if url.endswith("/files/company_tickers.json"):
            return httpx2.Response(200, json=json.loads((FIXTURES / "company_tickers.json").read_text()))
        if url.endswith("/submissions/CIK0000320193.json"):
            return httpx2.Response(200, json=json.loads((FIXTURES / "CIK0000320193.json").read_text()))
        if "/Archives/edgar/data/" in url:
            if self.fail_documents:
                return httpx2.Response(503)
            return httpx2.Response(200, text=(FIXTURES / "aapl-10q.htm").read_text())
        return httpx2.Response(404)


@pytest.fixture
def edgar():
    fake = FakeEdgar()
    with EdgarClient(USER_AGENT, transport=httpx2.MockTransport(fake.handler)) as client:
        yield fake, client


@pytest.fixture
def clean_filings():
    yield
    with get_engine().begin() as conn:
        conn.execute(text("TRUNCATE filings CASCADE"))
