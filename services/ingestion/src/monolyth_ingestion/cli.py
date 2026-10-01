"""Ingest filings by hand: uv run monolyth-ingest AAPL MSFT --since 2026-01-01

Runs once and exits. Scheduled ingestion for every held ticker will be a Celery task in services/sync.
"""

import argparse
import logging
import sys
from datetime import date

from sqlalchemy.orm import Session

from monolyth_db import get_engine
from monolyth_ingestion.config import ConfigError, sec_user_agent
from monolyth_ingestion.edgar import EdgarClient
from monolyth_ingestion.ingest import DEFAULT_FORMS, ingest_filings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("tickers", nargs="+")
    parser.add_argument("--since", type=date.fromisoformat, help="earliest filing date (default: 90 days ago)")
    parser.add_argument("--forms", default=",".join(sorted(DEFAULT_FORMS)), help="comma-separated form types")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    try:
        user_agent = sec_user_agent()
    except ConfigError as e:
        print(e, file=sys.stderr)
        return 2

    with EdgarClient(user_agent) as client, Session(get_engine()) as session:
        result = ingest_filings(
            session, client, args.tickers, frozenset(args.forms.split(",")), args.since
        )

    print(f"new filings: {len(result.new)}, parsed: {len(result.parsed)}")
    if result.unknown_tickers:
        print(f"not on EDGAR: {', '.join(result.unknown_tickers)}")
    for err in result.errors:
        print(f"error: {err}", file=sys.stderr)
    return 1 if result.errors else 0


if __name__ == "__main__":
    sys.exit(main())
