"""Filing embeddings (OpenAI text-embedding-3-small → pgvector) and semantic search over them."""

import logging
import os
from dataclasses import dataclass

import openai
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from monolyth_db import EMBEDDING_DIMENSIONS, Filing, FilingChunk

log = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"
# ~4 characters per token for English prose: ~2,000 characters ≈ 500 tokens per chunk, small
# enough that a search hit points at one passage, large enough to keep a paragraph's context
CHUNK_CHARS = 2_000
# Repeat the tail of each chunk at the start of the next, so a sentence split across a
# boundary is still found whole in one of them
OVERLAP_CHARS = 200
# Inputs per embeddings request; well under the API's 2,048-input and per-request token limits
BATCH_SIZE = 100


def chunk_text(text: str, size: int = CHUNK_CHARS, overlap: int = OVERLAP_CHARS) -> list[str]:
    """Splits on line boundaries (filing_text() puts one paragraph per line). A single line
    longer than `size` is split on whitespace, so no chunk exceeds `size` by much."""
    lines: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        while len(line) > size:
            cut = line.rfind(" ", 0, size)
            cut = cut if cut > size // 2 else size
            lines.append(line[:cut])
            line = line[cut:].strip()
        if line:
            lines.append(line)

    chunks: list[str] = []
    current = ""
    for line in lines:
        if current and len(current) + 1 + len(line) > size:
            chunks.append(current)
            tail = current[-overlap:]
            # Start the overlap at a word boundary, and drop it if it won't fit with this line
            current = tail[tail.find(" ") + 1 :] if " " in tail else ""
            if len(current) + 1 + len(line) > size:
                current = ""
        current = f"{current}\n{line}" if current else line
    if current:
        chunks.append(current)
    return chunks


def has_openai_key() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY"))


def embed_texts(client: openai.OpenAI, texts: list[str]) -> list[list[float]]:
    vectors: list[list[float]] = []
    for start in range(0, len(texts), BATCH_SIZE):
        batch = texts[start : start + BATCH_SIZE]
        res = client.embeddings.create(model=EMBEDDING_MODEL, input=batch)
        # The API returns one item per input with its index; sort rather than trust the order
        vectors.extend(item.embedding for item in sorted(res.data, key=lambda d: d.index))
    if any(len(v) != EMBEDDING_DIMENSIONS for v in vectors):
        raise ValueError(f"expected {EMBEDDING_DIMENSIONS}-dimension embeddings from {EMBEDDING_MODEL}")
    return vectors


def embed_pending(session: Session, client: openai.OpenAI, limit: int = 10) -> dict[str, int]:
    """Chunks and embeds parsed filings that have no chunks yet, newest first. A filing's
    chunks are written in one commit, so a failure part-way leaves it untouched for the next run."""
    pending = session.scalars(
        select(Filing)
        .where(Filing.text.is_not(None), Filing.text != "")
        .where(~exists().where(FilingChunk.filing_id == Filing.id))
        .order_by(Filing.filed_on.desc())
        .limit(limit)
    ).all()

    counts = {"filings": 0, "chunks": 0, "retry_later": 0}
    for filing in pending:
        chunks = chunk_text(filing.text)
        try:
            vectors = embed_texts(client, chunks)
        except (openai.RateLimitError, openai.APIConnectionError, openai.InternalServerError) as e:
            counts["retry_later"] += 1
            log.warning("filing %s: transient embeddings error, will retry: %s", filing.accession_number, e)
            continue
        session.add_all(
            FilingChunk(filing_id=filing.id, chunk_index=i, text=chunk, embedding=vector)
            for i, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True))
        )
        session.commit()
        counts["filings"] += 1
        counts["chunks"] += len(chunks)
    return counts


@dataclass(frozen=True)
class SearchHit:
    ticker: str
    company_name: str
    form: str
    filed_on: str
    document_url: str
    text: str
    # Cosine similarity, 1 = identical direction
    score: float


def search_filings(
    session: Session, client: openai.OpenAI, query: str, tickers: list[str], k: int = 8
) -> list[SearchHit]:
    """The `k` passages most similar to `query`, from filings of the given tickers."""
    if not tickers:
        return []
    [query_vector] = embed_texts(client, [query])
    distance = FilingChunk.embedding.cosine_distance(query_vector)
    rows = session.execute(
        select(FilingChunk.text, Filing, distance.label("distance"))
        .join(Filing, Filing.id == FilingChunk.filing_id)
        .where(Filing.ticker.in_([t.upper() for t in tickers]))
        .order_by(distance)
        .limit(k)
    )
    return [
        SearchHit(
            ticker=filing.ticker,
            company_name=filing.company_name,
            form=filing.form,
            filed_on=filing.filed_on.isoformat(),
            document_url=filing.document_url,
            text=text,
            score=1 - float(dist),
        )
        for text, filing, dist in rows
    ]
