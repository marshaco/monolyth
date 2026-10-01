import json
from datetime import date

import anthropic
import httpx2
import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from monolyth_db import Filing, get_engine
from monolyth_intelligence.summarize import (
    DEFAULT_MODEL,
    SummaryError,
    summarize_filing,
    summarize_pending,
)

SUMMARY = {
    "headline": "Apple Q3 sales up 8% as Services hits a record",
    "summary": "Apple's quarterly revenue rose 8% to $94.0 billion. Services set a record. "
    "Margins held steady. The company flagged tariff costs as a risk.",
}


class FakeClaude:
    """Stands in for the Messages API at the HTTP layer, so the real SDK builds and parses requests."""

    def __init__(self, input_tokens=5_000, stop_reason="end_turn", status=200, body=None):
        self.input_tokens = input_tokens
        self.stop_reason = stop_reason
        self.status = status
        self.body = body if body is not None else SUMMARY
        self.requests: list[tuple[str, dict]] = []

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        payload = json.loads(request.content)
        self.requests.append((request.url.path, payload))
        if request.url.path.endswith("/count_tokens"):
            return httpx2.Response(200, json={"input_tokens": self.input_tokens})
        if self.status != 200:
            return httpx2.Response(
                self.status, json={"type": "error", "error": {"type": "api_error", "message": "nope"}}
            )
        return httpx2.Response(
            200,
            json={
                "id": "msg_test",
                "type": "message",
                "role": "assistant",
                "model": payload["model"],
                "content": [{"type": "text", "text": json.dumps(self.body)}],
                "stop_reason": self.stop_reason,
                "stop_sequence": None,
                "stop_details": {"type": "refusal", "category": "cyber", "explanation": None}
                if self.stop_reason == "refusal"
                else None,
                "usage": {"input_tokens": self.input_tokens, "output_tokens": 80},
            },
        )

    def client(self) -> anthropic.Anthropic:
        return anthropic.Anthropic(
            api_key="sk-test",
            max_retries=0,
            http_client=anthropic.DefaultHttpxClient(transport=httpx2.MockTransport(self.handler)),
        )


def make_filing(**overrides) -> Filing:
    fields = dict(
        accession_number="0000320193-26-000090",
        ticker="AAPL",
        cik=320193,
        company_name="Apple Inc.",
        form="10-Q",
        filed_on=date(2026, 8, 1),
        report_date=date(2026, 6, 28),
        document_url="https://www.sec.gov/Archives/edgar/data/320193/x/aapl.htm",
        text="Apple Inc. reported net sales of 94,036 million.",
    )
    return Filing(**(fields | overrides))


@pytest.fixture(autouse=True)
def isolate(monkeypatch):
    monkeypatch.delenv("SUMMARY_MODEL", raising=False)
    monkeypatch.delenv("SUMMARY_MAX_INPUT_TOKENS", raising=False)
    yield
    with get_engine().begin() as conn:
        conn.execute(text("TRUNCATE filings CASCADE"))


def test_summarizes_with_structured_output():
    fake = FakeClaude()
    result = summarize_filing(fake.client(), make_filing())

    assert result.headline == SUMMARY["headline"] and result.summary == SUMMARY["summary"]
    (count_path, count_body), (path, body) = fake.requests
    assert count_path.endswith("/v1/messages/count_tokens") and path.endswith("/v1/messages")
    assert body["model"] == DEFAULT_MODEL == "claude-sonnet-4-6"
    assert "retail investors" in body["system"]
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert set(body["output_config"]["format"]["schema"]["properties"]) == {"headline", "summary"}
    prompt = body["messages"][0]["content"]
    assert "Apple Inc. (AAPL) filed a 10-Q on 2026-08-01, period ending 2026-06-28" in prompt
    assert "<filing>\nApple Inc. reported net sales of 94,036 million.\n</filing>" in prompt
    assert count_body["messages"] == body["messages"]  # token count matches what is sent


def test_model_is_configurable(monkeypatch):
    monkeypatch.setenv("SUMMARY_MODEL", "claude-sonnet-5-5")
    fake = FakeClaude()
    summarize_filing(fake.client(), make_filing())
    assert fake.requests[-1][1]["model"] == "claude-sonnet-5-5"


def test_too_long_is_skipped_not_truncated(monkeypatch):
    monkeypatch.setenv("SUMMARY_MAX_INPUT_TOKENS", "1000")
    fake = FakeClaude(input_tokens=1001)
    with pytest.raises(SummaryError, match="too long"):
        summarize_filing(fake.client(), make_filing())
    assert len(fake.requests) == 1  # only the token count; no summary request


@pytest.mark.parametrize("stop_reason, match", [("refusal", "declined.*cyber"), ("max_tokens", "incomplete")])
def test_unusable_responses_raise(stop_reason, match):
    with pytest.raises(SummaryError, match=match):
        summarize_filing(FakeClaude(stop_reason=stop_reason).client(), make_filing())


def test_pending_filings_are_summarized_and_stored():
    with Session(get_engine()) as session:
        session.add_all([
            make_filing(),
            make_filing(accession_number="unparsed", text=None),
        ])
        session.commit()
        counts = summarize_pending(session, FakeClaude().client())
        filings = {f.accession_number: f for f in session.scalars(select(Filing))}

    assert counts == {"summarized": 1, "failed": 0, "retry_later": 0}
    done = filings["0000320193-26-000090"]
    assert done.summary_headline == SUMMARY["headline"]
    assert done.summary == SUMMARY["summary"]
    assert done.summary_model == "claude-sonnet-4-6" and done.summarized_at is not None
    assert filings["unparsed"].summary is None


def test_failures_are_recorded_and_not_retried(monkeypatch):
    monkeypatch.setenv("SUMMARY_MAX_INPUT_TOKENS", "10")
    fake = FakeClaude(input_tokens=11)
    with Session(get_engine()) as session:
        session.add(make_filing())
        session.commit()
        assert summarize_pending(session, fake.client())["failed"] == 1
        assert "too long" in session.scalar(select(Filing.summary_error))
        assert summarize_pending(session, fake.client()) == {"summarized": 0, "failed": 0, "retry_later": 0}


@pytest.mark.parametrize("status", [429, 529, 500])
def test_transient_errors_leave_filing_for_next_run(status):
    with Session(get_engine()) as session:
        session.add(make_filing())
        session.commit()
        assert summarize_pending(session, FakeClaude(status=status).client())["retry_later"] == 1
        filing = session.scalar(select(Filing))
        assert filing.summary is None and filing.summary_error is None


def test_config_errors_propagate():
    with Session(get_engine()) as session:
        session.add(make_filing())
        session.commit()
        with pytest.raises(anthropic.BadRequestError):
            summarize_pending(session, FakeClaude(status=400).client())
