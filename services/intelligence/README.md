LLM layer (`monolyth_intelligence`). It turns parsed filings into plain-English insights.

It does two things: **filing summaries** (`summarize.py`, Claude) and **filing embeddings with semantic search** (`embed.py`, OpenAI `text-embedding-3-small` into pgvector).

- `summarize_filing(client, filing)`: a headline (at most 12 words, for alerts) plus a 3–5 sentence summary for a retail shareholder. It uses Claude structured output (`messages.parse` with a Pydantic model).
- `summarize_pending(session, client)`: summarises parsed filings that have no summary yet, newest first, 20 per run.
  - Rate limits, overload and network errors leave the filing for the next run (the SDK has already retried with backoff).
  - Filings that can't be summarised as they are (over the size limit, declined, incomplete) get `summary_error` set, so they aren't retried every run.
  - Configuration errors (bad key, unknown model) raise.

Filings are never truncated. Each filing's size is checked with `count_tokens` first, and anything over `SUMMARY_MAX_INPUT_TOKENS` is skipped and marked.

| Variable | Default |
|---|---|
| `ANTHROPIC_API_KEY` | none. Any SDK credential works, including an `ant auth login` profile. Summaries are skipped without one. |
| `SUMMARY_MODEL` | `claude-sonnet-4-6` (per CLAUDE.md) |
| `SUMMARY_MAX_INPUT_TOKENS` | `300000` (a cost guard; a typical 10-K is roughly 50–150k tokens) |

## Embeddings and search (`embed.py`)

- `chunk_text(text)`: about 2,000-character chunks (roughly 500 tokens) on paragraph boundaries, with 200 characters of overlap so a sentence split across a boundary still appears whole in one chunk.
- `embed_pending(session, client)`: chunks and embeds parsed filings that have no chunks yet, into `filing_chunks` (`vector(1536)` with an HNSW cosine index), in batches of 100 inputs per request.
  - Each filing's chunks are committed together.
  - Transient errors leave the filing for the next run. Authentication errors raise.
- `search_filings(session, client, query, tickers, k)`: the `k` passages most similar to the query, from the given tickers' filings, with cosine similarity scores.

| Variable | Default |
|---|---|
| `OPENAI_API_KEY` | none (embeddings are skipped without it) |

Both run as Celery tasks in `services/sync` (`tasks.summarize_filings`, `tasks.embed_filings`).
