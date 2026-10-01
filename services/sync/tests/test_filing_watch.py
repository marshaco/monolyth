import json
from pathlib import Path

import httpx2
import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

import tasks
from monolyth_db import Holding, User, get_engine
from monolyth_ingestion.edgar import EdgarClient
from worker import app

FIXTURES = Path(__file__).parents[2] / "ingestion/tests/fixtures"


class FakeEdgar:
    def __init__(self):
        self.urls: list[str] = []

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        url = str(request.url)
        self.urls.append(url)
        if url.endswith("/files/company_tickers.json"):
            return httpx2.Response(200, json=json.loads((FIXTURES / "company_tickers.json").read_text()))
        if url.endswith("/submissions/CIK0000320193.json"):
            return httpx2.Response(200, json=json.loads((FIXTURES / "CIK0000320193.json").read_text()))
        if "/Archives/edgar/data/" in url:
            return httpx2.Response(200, text=(FIXTURES / "aapl-10q.htm").read_text())
        return httpx2.Response(404)

    def client(self) -> EdgarClient:
        return EdgarClient("monolyth-tests test@example.org", transport=httpx2.MockTransport(self.handler))


@pytest.fixture(autouse=True)
def clean_db():
    yield
    with get_engine().begin() as conn:
        conn.execute(text("TRUNCATE filings, holdings, users CASCADE"))


def add_holdings(session: Session, clerk_id: str, tickers: list[str]) -> None:
    user = User(clerk_user_id=clerk_id)
    session.add(user)
    session.flush()
    session.add_all(Holding(user_id=user.id, ticker=t) for t in tickers)
    session.commit()


def test_held_tickers_are_distinct_across_users():
    with Session(get_engine()) as session:
        add_holdings(session, "user_a", ["AAPL", "MSFT"])
        add_holdings(session, "user_b", ["AAPL", "VOD.L"])
        assert tasks.held_tickers(session) == ["AAPL", "MSFT", "VOD.L"]


def test_no_holdings_makes_no_requests():
    fake = FakeEdgar()
    with Session(get_engine()) as session, fake.client() as client:
        result = tasks.run_filing_watch(session, client)
    assert fake.urls == [] and result.new == []


def test_ingests_each_held_company_once():
    fake = FakeEdgar()
    with Session(get_engine()) as session, fake.client() as client:
        add_holdings(session, "user_a", ["AAPL"])
        add_holdings(session, "user_b", ["AAPL", "VOD.L"])
        result = tasks.run_filing_watch(session, client)

    assert len(result.new) == 2 and len(result.parsed) == 2
    assert result.unknown_tickers == ["VOD.L"]
    assert sum(u.endswith("CIK0000320193.json") for u in fake.urls) == 1


def test_tasks_are_scheduled():
    assert app.conf.beat_schedule["watch-filings"]["task"] == "tasks.watch_filings"
    assert app.conf.beat_schedule["summarize-filings"]["task"] == "tasks.summarize_filings"
    assert {"tasks.watch_filings", "tasks.summarize_filings"} <= set(app.tasks)


def test_summaries_skip_without_anthropic_credentials(monkeypatch, tmp_path):
    for var in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))  # no `ant auth login` profile either
    assert tasks.summarize_filings.apply().get()["skipped"] == 1


def test_task_runs_and_queues_summaries(monkeypatch):
    fake = FakeEdgar()
    queued = []
    monkeypatch.setenv("SEC_USER_AGENT", "monolyth-tests test@example.org")
    monkeypatch.setattr(tasks, "EdgarClient", lambda ua: fake.client())
    monkeypatch.setattr(tasks.summarize_filings, "delay", lambda: queued.append(1))
    with Session(get_engine()) as session:
        add_holdings(session, "user_a", ["AAPL"])

    assert tasks.watch_filings.apply().get() == {"new": 2, "parsed": 2, "errors": 0}
    assert queued == [1]  # newly parsed filings trigger summarisation


def test_task_skips_without_sec_contact(monkeypatch):
    monkeypatch.delenv("SEC_USER_AGENT", raising=False)
    assert tasks.watch_filings.apply().get()["skipped"] == 1
