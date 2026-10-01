"""Celery app. Run with: cd services/sync && uv run celery -A worker worker -B --loglevel=info

-B runs the beat scheduler inside the worker, which is fine for local dev; in production run
`celery -A worker beat` as its own single process so schedules don't fire twice.
"""

import os

from celery import Celery

app = Celery(
    "monolyth",
    broker=os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
    include=["tasks"],
)

app.conf.update(
    timezone="UTC",
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    beat_schedule={
        "watch-filings": {
            "task": "tasks.watch_filings",
            "schedule": float(os.environ.get("FILING_WATCH_INTERVAL_SECONDS", 30 * 60)),
        },
        # Also triggered right after a watch run that parsed new filings; this catches the backlog
        "summarize-filings": {
            "task": "tasks.summarize_filings",
            "schedule": float(os.environ.get("SUMMARIZE_INTERVAL_SECONDS", 10 * 60)),
        },
    },
)
