Filing ingestion (`monolyth_ingestion`). It finds new company filings and stores them in the `filings` table with their plain text, ready for summarisation by `services/intelligence`.

**SEC EDGAR** (US) is implemented. Companies House / RNS (UK) is planned.

- `edgar.py`: `EdgarClient` covers ticker-to-CIK lookup, a company's recent filings (submissions API) and filing documents. It stays under SEC's 10 requests/second limit.
- `parse.py`: `filing_text()` turns EDGAR HTML/iXBRL into readable text. It drops hidden XBRL, scripts and styles, puts one paragraph per line, and writes tables as tab-separated rows.
- `ingest.py`: `ingest_filings()` records new 10-K, 10-Q and 8-K filings for the given tickers and fetches their text. For 8-Ks it also appends the EX-99 exhibits (usually the press release, where the substance is), found through the filing's index page. It's idempotent: known filings are skipped, and failed document fetches are retried on the next run.

## Configuration

The SEC requires a contact email in the `User-Agent` of every request (see [SEC fair access](https://www.sec.gov/os/accessing-edgar-data)):

```bash
export SEC_USER_AGENT="monolyth you@yourdomain.com"
```

## Run once by hand

```bash
uv run monolyth-ingest AAPL MSFT                # last 90 days of 10-K/10-Q/8-K
uv run monolyth-ingest AAPL --since 2026-01-01 --forms 10-K
```

Scheduled ingestion for every held ticker will be a Celery task in `services/sync`.
