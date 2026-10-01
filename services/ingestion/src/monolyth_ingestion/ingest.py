import logging
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

import httpx2
from sqlalchemy import select
from sqlalchemy.orm import Session

from monolyth_db import Filing
from monolyth_ingestion.edgar import EdgarClient
from monolyth_ingestion.parse import filing_text

log = logging.getLogger(__name__)

# The filings CLAUDE.md scopes for retail-investor summaries
DEFAULT_FORMS = frozenset({"10-K", "10-Q", "8-K"})
DEFAULT_LOOKBACK = timedelta(days=90)


@dataclass
class IngestResult:
    new: list[str] = field(default_factory=list)  # accession numbers inserted
    parsed: list[str] = field(default_factory=list)  # accession numbers whose text was fetched
    unknown_tickers: list[str] = field(default_factory=list)  # not on EDGAR (e.g. non-US listings)
    errors: list[str] = field(default_factory=list)


def ingest_filings(
    session: Session,
    client: EdgarClient,
    tickers: list[str],
    forms: frozenset[str] = DEFAULT_FORMS,
    since: date | None = None,
) -> IngestResult:
    """Records any new filings for `tickers` and fetches their text. Idempotent: filings
    already stored are skipped, and stored filings without text are retried."""
    since = since or date.today() - DEFAULT_LOOKBACK
    result = IngestResult()

    for ticker in tickers:
        try:
            company = client.company(ticker)
            if company is None:
                result.unknown_tickers.append(ticker)
                continue
            refs = client.recent_filings(company, set(forms), since)
        except httpx2.HTTPError as e:
            result.errors.append(f"{ticker}: {e}")
            continue

        known = set(
            session.scalars(
                select(Filing.accession_number).where(
                    Filing.accession_number.in_([r.accession_number for r in refs])
                )
            )
        )
        for ref in refs:
            if ref.accession_number in known:
                continue
            session.add(
                Filing(
                    accession_number=ref.accession_number,
                    ticker=ticker.upper(),
                    cik=company.cik,
                    company_name=company.name,
                    form=ref.form,
                    filed_on=ref.filed_on,
                    report_date=ref.report_date,
                    document_url=ref.document_url,
                    description=ref.description,
                )
            )
            result.new.append(ref.accession_number)
        session.commit()

    _parse_pending(session, client, tickers, result)
    return result


def _parse_pending(session: Session, client: EdgarClient, tickers: list[str], result: IngestResult) -> None:
    pending = session.scalars(
        select(Filing).where(Filing.text.is_(None), Filing.ticker.in_([t.upper() for t in tickers]))
    )
    for filing in pending:
        try:
            filing.text = filing_text(client.document(filing.document_url))
            filing.parsed_at = datetime.now(UTC)
            session.commit()
            result.parsed.append(filing.accession_number)
        except httpx2.HTTPError as e:
            session.rollback()
            result.errors.append(f"{filing.accession_number}: {e}")
