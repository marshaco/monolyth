import hashlib
import json
import math
import re
from datetime import date

import httpx2
import openai
import pytest
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from monolyth_db import EMBEDDING_DIMENSIONS, Filing, FilingChunk, get_engine
from monolyth_intelligence.embed import (
    BATCH_SIZE,
    EMBEDDING_MODEL,
    chunk_text,
    embed_pending,
    search_filings,
)


def fake_vector(text: str) -> list[float]:
    """Hashed bag of words, normalised: texts sharing words point in similar directions,
    so similarity search behaves meaningfully without a real model."""
    v = [0.0] * EMBEDDING_DIMENSIONS
    for word in re.findall(r"[a-z]+", text.lower()):
        v[int(hashlib.md5(word.encode()).hexdigest(), 16) % EMBEDDING_DIMENSIONS] += 1
    norm = math.sqrt(sum(x * x for x in v)) or 1
    return [x / norm for x in v]


class FakeOpenAI:
    def __init__(self, status=200):
        self.status = status
        self.batches: list[list[str]] = []

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content)
        assert request.url.path.endswith("/embeddings") and body["model"] == EMBEDDING_MODEL
        self.batches.append(body["input"])
        if self.status != 200:
            return httpx2.Response(self.status, json={"error": {"message": "nope", "type": "server_error"}})
        # Return items in reverse order to prove we sort by index
        data = [{"object": "embedding", "index": i, "embedding": fake_vector(t)} for i, t in enumerate(body["input"])]
        return httpx2.Response(
            200,
            json={"object": "list", "model": EMBEDDING_MODEL, "data": data[::-1], "usage": {"prompt_tokens": 1, "total_tokens": 1}},
        )

    def client(self) -> openai.OpenAI:
        return openai.OpenAI(
            api_key="sk-test",
            max_retries=0,
            http_client=openai.DefaultHttpx2Client(transport=httpx2.MockTransport(self.handler)),
        )


@pytest.fixture(autouse=True)
def clean():
    yield
    with get_engine().begin() as conn:
        conn.execute(text("TRUNCATE filing_chunks, filings CASCADE"))


def add_filing(session, accession, ticker, body):
    f = Filing(
        accession_number=accession, ticker=ticker, cik=1, company_name=f"{ticker} Inc.", form="10-K",
        filed_on=date(2026, 9, 1), document_url=f"https://www.sec.gov/{accession}.htm", text=body,
    )
    session.add(f)
    session.commit()
    return f


# --- chunking ---

def test_short_text_is_one_chunk():
    assert chunk_text("one\ntwo") == ["one\ntwo"]


def test_chunks_respect_size_and_overlap():
    lines = [f"Paragraph {i} " + "word " * 60 for i in range(40)]
    chunks = chunk_text("\n".join(lines), size=1000, overlap=100)
    assert len(chunks) > 1
    assert all(len(c) <= 1000 for c in chunks)
    for prev, nxt in zip(chunks, chunks[1:]):
        assert nxt.split("\n")[0] in prev  # each chunk opens with the tail of the previous one
    assert all(f"Paragraph {i} " in "\n".join(chunks) for i in range(40))  # nothing dropped


def test_overlong_line_is_split_on_words():
    chunks = chunk_text("word " * 1000, size=500, overlap=50)
    assert all(len(c) <= 500 for c in chunks)
    assert not any(c.startswith("ord") for c in chunks)


def test_empty_text():
    assert chunk_text("") == []


# --- embedding ---

def test_pending_filings_are_chunked_and_embedded():
    fake = FakeOpenAI()
    with Session(get_engine()) as session:
        add_filing(session, "a", "AAPL", "\n".join(f"Line {i} " + "text " * 50 for i in range(30)))
        add_filing(session, "empty", "AAPL", "")
        counts = embed_pending(session, fake.client())
        stored = session.scalars(select(FilingChunk).order_by(FilingChunk.chunk_index)).all()

    assert counts["filings"] == 1 and counts["chunks"] == len(stored) > 1
    assert [c.chunk_index for c in stored] == list(range(len(stored)))
    # embeddings stored in input order despite the API returning them reversed
    assert all(pytest.approx(list(c.embedding)) == fake_vector(c.text) for c in stored)


def test_second_run_is_a_no_op():
    fake = FakeOpenAI()
    with Session(get_engine()) as session:
        add_filing(session, "a", "AAPL", "Revenue grew.")
        embed_pending(session, fake.client())
        assert embed_pending(session, fake.client())["filings"] == 0
    assert len(fake.batches) == 1


def test_large_filings_are_batched():
    fake = FakeOpenAI()
    body = "\n".join(f"Paragraph {i} " + "word " * 300 for i in range(BATCH_SIZE * 2))
    with Session(get_engine()) as session:
        add_filing(session, "big", "AAPL", body)
        embed_pending(session, fake.client())
    assert len(fake.batches) >= 2 and all(len(b) <= BATCH_SIZE for b in fake.batches)


@pytest.mark.parametrize("status", [429, 500, 503])
def test_transient_errors_leave_filing_for_next_run(status):
    with Session(get_engine()) as session:
        add_filing(session, "a", "AAPL", "Revenue grew.")
        assert embed_pending(session, FakeOpenAI(status=status).client())["retry_later"] == 1
        assert session.scalar(select(func.count()).select_from(FilingChunk)) == 0


def test_auth_errors_propagate():
    with Session(get_engine()) as session:
        add_filing(session, "a", "AAPL", "Revenue grew.")
        with pytest.raises(openai.AuthenticationError):
            embed_pending(session, FakeOpenAI(status=401).client())


# --- search ---

def test_search_finds_the_relevant_passage_within_held_tickers():
    fake = FakeOpenAI()
    with Session(get_engine()) as session:
        add_filing(session, "a", "AAPL", "Gross margin pressure increased due to component costs and tariffs.\n" + "filler " * 400 + "\nThe board approved a share buyback.")
        add_filing(session, "n", "NVDA", "Data center revenue doubled on demand for accelerators.")
        add_filing(session, "m", "MSFT", "Margin pressure from cloud infrastructure costs and tariffs on hardware.")
        embed_pending(session, fake.client())

        hits = search_filings(session, fake.client(), "margin pressure from tariffs", ["aapl", "NVDA"], k=3)

    assert hits[0].ticker == "AAPL" and "margin pressure" in hits[0].text.lower()
    assert all(h.ticker in {"AAPL", "NVDA"} for h in hits)  # MSFT not held
    assert hits == sorted(hits, key=lambda h: h.score, reverse=True)


def test_search_with_no_tickers_skips_the_api():
    fake = FakeOpenAI()
    with Session(get_engine()) as session:
        assert search_filings(session, fake.client(), "anything", []) == []
    assert fake.batches == []
