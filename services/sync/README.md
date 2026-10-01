Celery workers for background and scheduled jobs, with Redis as the broker.

| Task | Schedule | What it does |
|---|---|---|
| `tasks.watch_filings` | every 30 min (`FILING_WATCH_INTERVAL_SECONDS`) | Ingests new SEC filings for every ticker any user holds (via `services/ingestion`), then queues `summarize_filings` if it parsed anything new. It skips with a warning if `SEC_USER_AGENT` isn't set. |
| `tasks.summarize_filings` | every 10 min (`SUMMARIZE_INTERVAL_SECONDS`), and after a watch run | Writes Claude summaries for parsed filings (via `services/intelligence`), 20 per run. It skips with a warning if there are no Anthropic credentials. |

Planned: portfolio sync from brokerages, news polling, and filing embeddings.

Run (from this directory):

```bash
uv run celery -A worker worker -B --loglevel=info   # -B embeds the scheduler; dev only
```

In production, run `celery -A worker beat` as one separate process, plus as many `worker` processes as needed.

| Variable | Default |
|---|---|
| `REDIS_URL` | `redis://localhost:6379/0` |
| `SEC_USER_AGENT` | none (filing watch skips until set) |
| `FILING_WATCH_INTERVAL_SECONDS` | `1800` |
| `ANTHROPIC_API_KEY` | none (summaries skip until set) |
| `SUMMARY_MODEL` | `claude-sonnet-4-6` |
| `SUMMARIZE_INTERVAL_SECONDS` | `600` |
