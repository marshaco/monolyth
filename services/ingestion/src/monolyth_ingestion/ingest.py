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
# An 8-K's cover document is mostly boilerplate ("Item 2.02 ... see Exhibit 99.1"); the substance,
# usually the press release, is in its EX-99 exhibits, so those are appended to its text
EXHIBIT_FORMS = frozenset({"8-K"})
EXHIBIT_TYPE_PREFIX = "EX-99"
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
            filing.text = _filing_full_text(client, filing)
            filing.parsed_at = datetime.now(UTC)
            session.commit()
            result.parsed.append(filing.accession_number)
        except httpx2.HTTPError as e:
            session.rollback()
            result.errors.append(f"{filing.accession_number}: {e}")


def _filing_full_text(client: EdgarClient, filing: Filing) -> str:
    parts = [filing_text(client.document(filing.document_url))]
    if filing.form in EXHIBIT_FORMS:
        for exhibit in client.exhibits(filing.cik, filing.accession_number):
            if exhibit.type.startswith(EXHIBIT_TYPE_PREFIX) and exhibit.url != filing.document_url:
                label = exhibit.type.removeprefix("EX-")
                heading = f"Exhibit {label}" + (f": {exhibit.description}" if exhibit.description else "")
                parts.append(f"{heading}\n{filing_text(client.document(exhibit.url))}")
    return "\n\n".join(parts)
