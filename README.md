# MONOLYTH

> All your insights, in one place.

Monolyth is an AI-powered investment intelligence platform that aggregates your portfolio across brokerages, crypto exchanges, and pensions, then surfaces insights drawn from earnings filings, investor reports, and market data — explained in plain English.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), Tailwind CSS, shadcn/ui, Recharts/Tremor |
| Backend API | FastAPI (Python) |
| Database | PostgreSQL + pgvector |
| Auth | Clerk |
| Portfolio Aggregation | Plaid (US), Nordigen/GoCardless (EU), direct exchange APIs (crypto) |
| AI / LLM | Claude API (Anthropic) |
| Embeddings | OpenAI text-embedding-3-small |
| Caching | Redis |
| Job Queue | BullMQ / Celery |
| Infrastructure | Docker Compose (local dev), Nginx, Railway/Render (prod) |
| Data Sources | SEC EDGAR, Companies House/RNS, Polygon.io / Alpha Vantage |

## Repository Structure

```
monolyth/
├── apps/
│   ├── api/              # FastAPI backend
│   └── web/              # Next.js frontend (App Router)
├── packages/
│   ├── db/               # Shared database package (schema, migrations, client)
│   └── types/            # Shared TypeScript types
├── services/
│   ├── ingestion/        # Document ingestion service
│   ├── intelligence/     # AI/LLM analysis layer
│   └── sync/             # Background sync jobs
└── infra/
    ├── docker-compose.yml
    └── nginx/
```

## apps/api

FastAPI (Python) backend. Handles portfolio aggregation via Plaid (US) and Nordigen/GoCardless (EU), crypto exchange API connections, and exposes endpoints consumed by `apps/web`.

## apps/web

Next.js frontend using the App Router. SSR for fast initial loads with streaming for real-time insight updates. Built with Tailwind CSS + shadcn/ui and Recharts/Tremor for portfolio visualisations. Auth handled by Clerk.

## packages/db

Shared database package used across the monorepo. Contains schema definitions, migrations, and the database client. PostgreSQL with the `pgvector` extension for vector/semantic search across filings.

## packages/types

Shared TypeScript types used across `apps/` and `services/` — portfolios, holdings, filings, embeddings, etc.

## services/ingestion

Pulls and parses raw financial documents from external sources: SEC EDGAR (US filings), Companies House/RNS (UK), and structured data from Polygon.io / Alpha Vantage.

## services/intelligence

AI/LLM layer that transforms parsed documents into embeddings and plain-English insights. Uses the Claude API (Anthropic) for summarisation and insight generation, and OpenAI `text-embedding-3-small` for embeddings stored in pgvector.

## services/sync

Background job queue (BullMQ or Celery) for scheduled tasks: daily portfolio value syncs, new filing detection, and embedding generation for newly indexed documents. Redis backs the job queue and caches computed portfolio values.

## infra

Docker Compose config for local development (PostgreSQL+pgvector, Redis, Nginx). The `nginx/` directory contains reverse proxy config routing traffic between `apps/web` and `apps/api`.

## GitHub

[https://github.com/marshaco/monolyth](https://github.com/marshaco/monolyth)

