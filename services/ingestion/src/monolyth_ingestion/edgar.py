"""Minimal SEC EDGAR client: ticker → CIK lookup, a company's recent filings, and documents.

Endpoints and formats: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
"""

import threading
import time
from dataclasses import dataclass
from datetime import date
from urllib.parse import urljoin

import httpx2
from bs4 import BeautifulSoup

TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
ARCHIVE_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{document}"
# Human-readable filing index; its document table is the only place that gives each exhibit's type
INDEX_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession_nodash}/{accession}-index.htm"

# SEC's fair-access limit is 10 requests/second per client
MAX_REQUESTS_PER_SECOND = 10


@dataclass(frozen=True)
class Company:
    cik: int
    ticker: str
    name: str


@dataclass(frozen=True)
class FilingRef:
    accession_number: str
    form: str
    filed_on: date
    report_date: date | None
    document_url: str
    description: str | None


@dataclass(frozen=True)
class Exhibit:
    type: str  # e.g. "EX-99.1"
    description: str | None
    url: str


def parse_filing_index(html: str) -> list[Exhibit]:
    """Documents listed in a filing index page's "Document Format Files" table
    (columns: Seq, Description, Document, Type, Size)."""
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table", class_="tableFile")
    if table is None:
        return []
    out = []
    for row in table.find_all("tr")[1:]:
        cells = row.find_all("td")
        link = cells[2].find("a") if len(cells) >= 4 else None
        if link is None or not link.get("href"):
            continue
        # Inline-XBRL documents link through the viewer: /ix?doc=/Archives/...
        href = link["href"].removeprefix("/ix?doc=")
        out.append(
            Exhibit(
                type=cells[3].get_text(strip=True),
                description=cells[1].get_text(strip=True) or None,
                url=urljoin("https://www.sec.gov/", href),
            )
        )
    return out


class EdgarClient:
    def __init__(self, user_agent: str, transport: httpx2.BaseTransport | None = None):
        self._http = httpx2.Client(
            headers={"User-Agent": user_agent, "Accept-Encoding": "gzip, deflate"},
            timeout=30,
            follow_redirects=True,
            transport=transport,
        )
        self._lock = threading.Lock()
        self._last_request = 0.0
        self._tickers: dict[str, Company] | None = None

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "EdgarClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def _get(self, url: str) -> httpx2.Response:
        with self._lock:
            wait = self._last_request + 1 / MAX_REQUESTS_PER_SECOND - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last_request = time.monotonic()
        res = self._http.get(url)
        res.raise_for_status()
        return res

    def company(self, ticker: str) -> Company | None:
        """Looks up a ticker's CIK. EDGAR lists share classes with a dash (BRK-B), so dots are mapped."""
        if self._tickers is None:
            data = self._get(TICKERS_URL).json()
            self._tickers = {
                row["ticker"].upper(): Company(cik=int(row["cik_str"]), ticker=row["ticker"].upper(), name=row["title"])
                for row in data.values()
            }
        return self._tickers.get(ticker.upper().replace(".", "-"))

    def recent_filings(self, company: Company, forms: set[str], since: date) -> list[FilingRef]:
        """Filings of the given forms filed on or after `since`, newest first.
        Uses the submissions API's `recent` block (the latest ~1000 filings), which is
        plenty for watching new filings."""
        recent = self._get(SUBMISSIONS_URL.format(cik=company.cik)).json()["filings"]["recent"]
        out = []
        for i, form in enumerate(recent["form"]):
            filed_on = date.fromisoformat(recent["filingDate"][i])
            if form not in forms or filed_on < since or not recent["primaryDocument"][i]:
                continue
            accession = recent["accessionNumber"][i]
            report = recent["reportDate"][i]
            out.append(
                FilingRef(
                    accession_number=accession,
                    form=form,
                    filed_on=filed_on,
                    report_date=date.fromisoformat(report) if report else None,
                    document_url=ARCHIVE_URL.format(
                        cik=company.cik,
                        accession=accession.replace("-", ""),
                        document=recent["primaryDocument"][i],
                    ),
                    description=recent["primaryDocDescription"][i] or None,
                )
            )
        return sorted(out, key=lambda f: f.filed_on, reverse=True)

    def document(self, url: str) -> str:
        return self._get(url).text

    def exhibits(self, cik: int, accession_number: str) -> list[Exhibit]:
        url = INDEX_URL.format(
            cik=cik, accession_nodash=accession_number.replace("-", ""), accession=accession_number
        )
        return parse_filing_index(self._get(url).text)
