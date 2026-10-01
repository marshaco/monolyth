Celery workers for background and scheduled jobs, with Redis as the broker.

| Task | Schedule | What it does |
|---|---|---|
| `tasks.watch_filings` | every 30 min (`FILING_WATCH_INTERVAL_SECONDS`) | Ingests new SEC filings for every ticker any user holds (via `services/ingestion`). It skips with a warning if `SEC_USER_AGENT` isn't set. |

Planned: portfolio sync from brokerages, news polling, and summarising new filings.

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
