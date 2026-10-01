LLM layer (`monolyth_intelligence`). It turns parsed filings into plain-English insights.

**Filing summaries** (`summarize.py`) are implemented. Embeddings into pgvector (OpenAI `text-embedding-3-small`) are planned.

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

Runs via the `tasks.summarize_filings` Celery task in `services/sync`.
