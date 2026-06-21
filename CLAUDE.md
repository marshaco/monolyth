# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Note

Not all features outlined below, as this project is a work-in-progress.

## Project

**monolyth** — "All your insights, in one place."

An AI-powered investment intelligence platform. Users connect their brokerage accounts (Robinhood, Trading 212, etc.), and the platform automatically surfaces:
- Plain-English summaries of investor reports and filings for companies they hold
- News relevant to their specific holdings
- Investment recommendations based on portfolio composition and filing analysis

- GitHub: https://github.com/marshaco/monolyth
- Main branch: `main`

## Core Features

### 1. Portfolio Connection
- Sync holdings from Robinhood (unofficial API / Plaid), Trading 212 (CSV export or unofficial API), and other brokerages
- Normalize holdings into a unified schema: `{ticker, name, quantity, avg_cost, current_price, brokerage}`
- Support multiple brokerages per user

### 2. Filing Intelligence
- When a company a user holds publishes an investor report (SEC 10-K/10-Q/8-K, UK RNS), automatically ingest and analyse it
- Use Claude to produce a 3–5 sentence plain-English summary focused on what matters to a retail investor
- Store embeddings (OpenAI text-embedding-3-small) in pgvector for semantic search
- Alert users in-app when a new filing drops for one of their holdings

### 3. News Feed
- Surface news articles relevant to each user's holdings, ranked by relevance and recency
- Tag articles to specific holdings in the user's portfolio
- Sources: Polygon.io news, Alpha Vantage news, and direct RSS feeds

### 4. Investment Recommendations
- Analyse portfolio composition (sector concentration, geographic exposure, risk profile)
- Use Claude to suggest related or complementary assets based on the user's current holdings and their filing summaries
- Frame recommendations in plain English with reasoning, not just tickers

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), Tailwind CSS, shadcn/ui, Recharts/Tremor |
| Backend API | FastAPI (Python) |
| Database | PostgreSQL + pgvector |
| Auth | Clerk |
| Portfolio Aggregation | Plaid (US), Trading 212 CSV/API, Robinhood unofficial API (`robin_stocks`) |
| LLM | Claude API (Anthropic) — use `claude-sonnet-4-6` for summaries, `claude-opus-4-8` for complex analysis |
| Embeddings | OpenAI `text-embedding-3-small` |
| Caching | Redis |
| Job Queue | Celery + Redis (background filing ingestion and portfolio sync) |
| Infrastructure | Docker Compose (local), Nginx, Railway/Render (prod) |
| Data Sources | SEC EDGAR (EDGAR full-text search API), Companies House / RNS (London Stock Exchange), Polygon.io, Alpha Vantage |

## Monorepo Structure

```
apps/api/              # FastAPI backend — REST API consumed by the frontend
apps/web/              # Next.js frontend (App Router)
packages/db/           # Shared DB package — SQLAlchemy models, Alembic migrations, client
packages/types/        # Shared TypeScript types (mirrored from Python models)
services/ingestion/    # Pulls and parses raw filings (SEC EDGAR, RNS)
services/intelligence/ # LLM layer: embeddings (OpenAI) + insights (Claude API)
services/sync/         # Celery workers: portfolio sync, filing watch, news fetch
infra/
  docker-compose.yml   # Local dev: PostgreSQL+pgvector, Redis, Nginx
  nginx/               # Reverse proxy config
```

## Key Data Flows

### Filing ingestion
1. `services/sync` watches SEC EDGAR / RNS for new filings for tickers in users' portfolios
2. New filing detected → `services/ingestion` fetches and parses it (HTML/XBRL → plain text)
3. `services/intelligence` chunks the text, generates embeddings (OpenAI), stores in pgvector
4. `services/intelligence` calls Claude to generate a plain-English summary
5. `apps/api` serves the summary; `apps/web` shows an in-app alert to users holding that ticker

### Portfolio sync
1. User connects brokerage via Plaid OAuth or Trading 212 CSV upload or `robin_stocks` credentials
2. `apps/api` normalises holdings → stores in PostgreSQL
3. `services/sync` re-syncs periodically (e.g. every 15 min for prices, daily for positions)
4. Redis caches computed portfolio values (total value, P&L, sector breakdown)

### News feed
1. `services/sync` polls Polygon.io / Alpha Vantage news endpoints for each ticker in the user's portfolio
2. Articles stored in PostgreSQL with embeddings; ranked by recency and relevance to holdings
3. `apps/api` serves paginated feed; `apps/web` renders per-holding news cards

## Architecture Notes

- **pgvector** is the vector store — filing embeddings live in PostgreSQL alongside relational data, enabling semantic search across a user's holdings ("what have my holdings said about margin pressure?").
- **Celery + Redis** handles all async/background work: filing ingestion triggers, portfolio sync jobs, news polling.
- Keep the FastAPI backend stateless — all state lives in PostgreSQL or Redis.
- Never store raw brokerage credentials in the database. Use Plaid tokens; for Trading 212 use short-lived session tokens or CSV only.

## Commands

> Update this section as tooling is added.


```bash
# Start local infrastructure (Postgres, Redis, Nginx)
docker compose -f infra/docker-compose.yml up -d

# API (FastAPI)
cd apps/api && uvicorn main:app --reload

# Web (Next.js)
cd apps/web && npm run dev

# Celery worker
cd services/sync && celery -A worker worker --loglevel=info
```


At the end of each coding stage, for when the code is ready to be pushed to GitHub, you should provide a summary of the problem that needed to be fixed, the thing that was actually fixed, the changes that were made, and what tests were conducted to validate that the code works for the fix. It should follow a consistent format of bold heading and bullet points answering each question.