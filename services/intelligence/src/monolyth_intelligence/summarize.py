"""Plain-English filing summaries for retail investors, via the Claude API."""

import logging
import os
from datetime import UTC, datetime

import anthropic
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from monolyth_db import Filing

log = logging.getLogger(__name__)

# CLAUDE.md: Sonnet for summaries. Override with SUMMARY_MODEL.
DEFAULT_MODEL = "claude-sonnet-4-6"
# Cost guard, not a context limit: a filing over this many input tokens is skipped (and marked)
# rather than truncated, since a summary of half a 10-K could miss what matters.
DEFAULT_MAX_INPUT_TOKENS = 300_000

SYSTEM_PROMPT = """\
You summarise company filings (SEC 10-K, 10-Q and 8-K reports) for retail investors who own the \
company's stock but aren't finance professionals.

Write a summary of 3 to 5 sentences in plain English that tells a shareholder what this filing \
means for them: what happened or changed, the most important numbers with their direction \
(e.g. revenue up 8% year over year), and any material risks, guidance changes, leadership \
changes, deals or legal matters. Lead with the single most important point. Explain any jargon \
you can't avoid. Stay factual and neutral: report what the filing says, don't speculate beyond \
it, and don't give buy or sell advice.

Also write a headline of at most 12 words naming the company and the key point, suitable for an \
in-app alert.

The filing text comes from an automated HTML-to-text conversion, so tables appear as \
tab-separated rows and some boilerplate may remain; ignore the boilerplate."""


class FilingSummary(BaseModel):
    headline: str = Field(description="At most 12 words, naming the company and the key point")
    summary: str = Field(description="3 to 5 plain-English sentences for a retail shareholder")


class SummaryError(Exception):
    """A filing that can't be summarised as-is; the reason is stored so it isn't retried."""


def has_credentials(client: anthropic.Anthropic) -> bool:
    """Whether the SDK resolved any credentials (API key, auth token, or an `ant auth login`
    profile). Without them it raises only when the first request is built."""
    return any(getattr(client, attr, None) is not None for attr in ("api_key", "auth_token", "credentials"))


def summary_model() -> str:
    return os.environ.get("SUMMARY_MODEL", DEFAULT_MODEL)


def max_input_tokens() -> int:
    return int(os.environ.get("SUMMARY_MAX_INPUT_TOKENS", DEFAULT_MAX_INPUT_TOKENS))


def _messages(filing: Filing) -> list[dict]:
    period = f", period ending {filing.report_date.isoformat()}" if filing.report_date else ""
    return [
        {
            "role": "user",
            "content": (
                f"{filing.company_name} ({filing.ticker}) filed a {filing.form} on "
                f"{filing.filed_on.isoformat()}{period}.\n\n"
                f"<filing>\n{filing.text}\n</filing>"
            ),
        }
    ]


def summarize_filing(client: anthropic.Anthropic, filing: Filing, model: str | None = None) -> FilingSummary:
    model = model or summary_model()
    messages = _messages(filing)

    tokens = client.messages.count_tokens(model=model, system=SYSTEM_PROMPT, messages=messages).input_tokens
    if tokens > max_input_tokens():
        raise SummaryError(f"too long to summarise: {tokens:,} input tokens (limit {max_input_tokens():,})")

    response = client.messages.parse(
        model=model,
        max_tokens=2000,
        system=SYSTEM_PROMPT,
        messages=messages,
        output_format=FilingSummary,
    )
    if response.stop_reason == "refusal":
        category = response.stop_details.category if response.stop_details else None
        raise SummaryError(f"model declined to summarise (category: {category})")
    if response.stop_reason == "max_tokens" or response.parsed_output is None:
        raise SummaryError(f"incomplete summary (stop_reason: {response.stop_reason})")
    return response.parsed_output


def summarize_pending(session: Session, client: anthropic.Anthropic, limit: int = 20) -> dict[str, int]:
    """Summarises parsed filings that don't have a summary yet, newest first.

    Transient API failures (rate limits, overload, network) leave the filing untouched so the
    next run retries it; filings that can never be summarised as-is get `summary_error` set."""
    model = summary_model()
    pending = session.scalars(
        select(Filing)
        .where(Filing.text.is_not(None), Filing.summary.is_(None), Filing.summary_error.is_(None))
        .order_by(Filing.filed_on.desc())
        .limit(limit)
    ).all()

    counts = {"summarized": 0, "failed": 0, "retry_later": 0}
    for filing in pending:
        try:
            result = summarize_filing(client, filing, model)
        except SummaryError as e:
            filing.summary_error = str(e)[:255]
            counts["failed"] += 1
            log.warning("filing %s not summarised: %s", filing.accession_number, e)
        except (anthropic.RateLimitError, anthropic.APIConnectionError) as e:
            # The SDK already retried with backoff; leave it for the next run
            counts["retry_later"] += 1
            log.warning("filing %s: transient API error, will retry: %s", filing.accession_number, e)
            continue
        except anthropic.APIStatusError as e:
            if e.status_code < 500:
                raise  # bad key, unknown model, malformed request: a config problem, not this filing's
            counts["retry_later"] += 1
            log.warning("filing %s: API %d, will retry: %s", filing.accession_number, e.status_code, e)
            continue
        else:
            filing.summary_headline = result.headline[:255]
            filing.summary = result.summary
            filing.summary_model = model
            filing.summarized_at = datetime.now(UTC)
            counts["summarized"] += 1
        session.commit()
    return counts
