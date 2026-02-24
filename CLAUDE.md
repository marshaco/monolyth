# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**monolyth** — "All your insights, in one place."

An AI-powered investment intelligence platform. Aggregates portfolios across brokerages, crypto, and pensions, then surfaces insights from financial filings (SEC, RNS) explained in plain English.

- GitHub: https://github.com/marshaco/monolyth
- Main branch: `main`

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), Tailwind CSS, shadcn/ui, Recharts/Tremor |
| Backend API | FastAPI (Python) |
| Database | PostgreSQL + pgvector |
| Auth | Clerk |
| Portfolio Aggregation | Plaid (US), Nordigen/GoCardless (EU), direct exchange APIs (crypto) |
| LLM | Claude API (Anthropic) — prefer claude-sonnet-4-6 or claude-opus-4-6 |
| Embeddings | OpenAI text-embedding-3-small |
| Caching | Redis |
| Job Queue | BullMQ or Celery |
| Infrastructure | Docker Compose (local), Nginx, Railway/Render (prod) |
| Data Sources | SEC EDGAR, Companies House/RNS, Polygon.io, Alpha Vantage |

## Monorepo Structure

```
apps/api/              # FastAPI backend
apps/web/              # Next.js frontend (App Router)
packages/db/           # Shared DB package — schema, migrations, client
packages/types/        # Shared TypeScript types
services/ingestion/    # Pulls and parses raw filings (SEC EDGAR, RNS, Polygon.io)
services/intelligence/ # LLM layer: embeddings (OpenAI) + insights (Claude API)
services/sync/         # Background jobs (BullMQ/Celery) for portfolio + filing sync
infra/
  docker-compose.yml   # Local dev: PostgreSQL+pgvector, Redis, Nginx
  nginx/               # Reverse proxy config
```

## Architecture Notes

- **pgvector** is the vector store — embeddings for filings live in PostgreSQL alongside relational data. Enables semantic search across holdings' filings ("what have my holdings said about margin pressure?").
- **Intelligence pipeline**: `services/ingestion` fetches raw filings → `services/intelligence` generates embeddings (OpenAI) and stores in pgvector → Claude API produces plain-English insights → surfaced via `apps/web`.
- **Portfolio data flow**: Plaid/Nordigen webhooks → `apps/api` → normalized holdings in PostgreSQL → Redis (via `services/sync`) caches computed portfolio values.
- No commands, build tooling, or test setup are configured yet — update this file as they are added.
