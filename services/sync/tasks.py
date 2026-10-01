import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from monolyth_db import Holding, get_engine
from monolyth_ingestion.config import ConfigError, sec_user_agent
from monolyth_ingestion.edgar import EdgarClient
from monolyth_ingestion.ingest import IngestResult, ingest_filings
from worker import app

log = logging.getLogger(__name__)


def held_tickers(session: Session) -> list[str]:
    """Every ticker any user holds, so each company's filings are fetched once, not per user."""
    return sorted(set(session.scalars(select(Holding.ticker).distinct())))


def run_filing_watch(session: Session, client: EdgarClient) -> IngestResult:
    tickers = held_tickers(session)
    if not tickers:
        return IngestResult()
    result = ingest_filings(session, client, tickers)
    log.info(
        "filing watch: %d tickers, %d new filings, %d parsed, %d unknown, %d errors",
        len(tickers), len(result.new), len(result.parsed), len(result.unknown_tickers), len(result.errors),
    )
    for err in result.errors:
        log.warning("filing watch error: %s", err)
    return result


# Scheduled by beat (see worker.py). No automatic retries: the next scheduled run picks up
# anything that failed, because ingestion is idempotent.
@app.task(name="tasks.watch_filings")
def watch_filings() -> dict[str, int]:
    # dev.sh starts this worker for everyone, so a missing SEC contact skips rather than erroring every run
    try:
        user_agent = sec_user_agent()
    except ConfigError as e:
        log.warning("filing watch skipped: %s", e)
        return {"new": 0, "parsed": 0, "errors": 0, "skipped": 1}

    with EdgarClient(user_agent) as client, Session(get_engine()) as session:
        result = run_filing_watch(session, client)
    return {"new": len(result.new), "parsed": len(result.parsed), "errors": len(result.errors)}
