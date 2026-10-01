# monolyth

> All your insights, in one place.

monolyth is an AI-powered investment intelligence platform for retail investors. You connect your brokerage accounts, and monolyth keeps track of everything that matters to the companies you own: the news, what their latest filings actually say, and what it all means for your portfolio, explained in plain English.

![The monolyth news feed: holdings in the sidebar, news cards for each holding](docs/screenshot.png)

## Why

If you hold a dozen stocks across two or three brokerages, staying informed is a chore. The news is scattered across dozens of outlets, many of them paywalled. Earnings reports and SEC filings run to hundreds of pages. And no single app sees your whole portfolio.

monolyth puts it in one place:

- **One portfolio**, synced from every brokerage you use
- **News about what you own**, not the market at large
- **Filings you'll actually read**: a 10-K boiled down to the few sentences a retail investor needs
- **Suggestions with reasons**, based on what you hold and what those companies are saying

## Features

| Feature | Status |
|---|---|
| **News feed per holding**: articles from many outlets, de-duplicated, rotated across your holdings, with images and paywall labels | ✅ Working |
| **Holdings**: add tickers by hand and keep them across sessions | ✅ Working (moving from the browser to the API) |
| **REST API and database**: FastAPI, PostgreSQL with pgvector, Alembic migrations | ✅ Foundation in place |
| **Brokerage sync**: Robinhood, Trading 212 and more ([#6](https://github.com/marshaco/monolyth/issues/6), [#7](https://github.com/marshaco/monolyth/issues/7)) | 🔜 Planned |
| **Filing intelligence**: SEC 10-K/10-Q/8-K and UK RNS filings summarised by Claude, with alerts when a holding files | 🔜 Planned |
| **Semantic search across your holdings' filings** ("what have my holdings said about margin pressure?") | 🔜 Planned |
| **Personalised feed ranking** ([#10](https://github.com/marshaco/monolyth/issues/10), [#12](https://github.com/marshaco/monolyth/issues/12), [#13](https://github.com/marshaco/monolyth/issues/13)) | 🔜 Planned |
| **Portfolio analysis and recommendations**: sector and geographic exposure, plus complementary ideas with reasoning | 🔜 Planned |

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), Tailwind CSS, shadcn/ui |
| Backend API | FastAPI (Python) |
| Database | PostgreSQL + pgvector, SQLAlchemy 2.0, Alembic |
| Auth | Clerk (planned) |
| LLM | Claude API (Anthropic) for summaries and analysis |
| Embeddings | OpenAI `text-embedding-3-small` |
| Background jobs | Celery + Redis |
| Data sources | Bing News RSS, SEC EDGAR, Companies House / RNS, Polygon.io, Alpha Vantage |
| Tooling | uv (Python), npm (web), Docker Compose (local infrastructure), nginx |

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 20.9 or newer
- [uv](https://docs.astral.sh/uv/getting-started/installation/), which installs the right Python for you
- [Docker](https://docs.docker.com/get-docker/) with Docker Compose

### Install

```bash
git clone https://github.com/marshaco/monolyth.git
cd monolyth

uv sync --all-packages             # Python: API + shared DB package, into .venv/
(cd apps/web && npm install)       # Web frontend
```

### Environment variables

Nothing is required for local development. The defaults match the Docker Compose services.

| Variable | Used by | Default |
|---|---|---|
| `DATABASE_URL` | API, migrations | `postgresql+psycopg://monolyth:monolyth@localhost:5433/monolyth` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `infra/docker-compose.yml` | `monolyth` / `monolyth` / `monolyth` |

API keys (Anthropic, OpenAI, Clerk, Polygon) will be added here as the features that need them land. Never commit them: `.env` and `.env*.local` are git-ignored.

### Run

The quickest way is the dev script. It starts Postgres, Redis and nginx in Docker, applies database migrations, then runs the API and the web app:

```bash
./dev.sh
```

| Service | URL |
|---|---|
| Web app | http://localhost:3000 |
| API (with interactive docs) | http://localhost:8000/docs |
| Everything behind nginx | http://localhost:8080 |
| Postgres | `localhost:5433` (user, password and database all `monolyth`) |

Or run the pieces yourself:

```bash
docker compose -f infra/docker-compose.yml up -d        # Postgres, Redis, nginx
(cd packages/db && uv run alembic upgrade head)         # apply migrations
(cd apps/api && uv run uvicorn main:app --reload)       # API on :8000
(cd apps/web && npm run dev)                            # web on :3000
```

### Tests

```bash
uv run pytest                                  # API + migrations (uses a separate monolyth_test database)
(cd apps/web && npx tsc --noEmit)              # type-check the frontend
```

## Project structure

```
apps/
  web/             Next.js frontend: the app UI, plus the news route handlers (/api/news, /api/og-image)
  api/             FastAPI backend: REST API under /v1, consumed by the frontend
packages/
  db/              Shared Python package: SQLAlchemy models, Alembic migrations, DB session
  types/           Shared TypeScript types, mirrored from the API
services/
  ingestion/       (planned) Fetches and parses filings from SEC EDGAR and RNS
  intelligence/    (planned) Embeddings and Claude summaries
  sync/            (planned) Celery workers: portfolio sync, filing watch, news polling
infra/
  docker-compose.yml   Local Postgres + pgvector, Redis, nginx
  nginx/               Reverse proxy: /api/v1/* to the API, everything else to the web app
dev.sh             Starts everything for local development
```

### How the pieces fit

1. **Holdings** are stored in Postgres through the API. Later, brokerage sync will keep them up to date automatically.
2. **News** is fetched per holding, de-duplicated across outlets, and rotated so no single holding or outlet dominates.
3. **Filings** (planned): a background worker watches EDGAR and RNS for your holdings. New filings are parsed, chunked and embedded into pgvector, then summarised by Claude, and you get an alert in the app.

## Roadmap

Work is tracked in [GitHub issues](https://github.com/marshaco/monolyth/issues). Roughly in order:

1. Holdings on the server, then sign-in with Clerk
2. Filing ingestion from SEC EDGAR, Claude summaries and in-app filing alerts
3. News moved to a background pipeline, then personalised ranking ([#10](https://github.com/marshaco/monolyth/issues/10)–[#15](https://github.com/marshaco/monolyth/issues/15))
4. Brokerage sync via SnapTrade ([#6](https://github.com/marshaco/monolyth/issues/6), [#7](https://github.com/marshaco/monolyth/issues/7))
5. Portfolio analysis and recommendations
6. Public landing page ([#2](https://github.com/marshaco/monolyth/issues/2))
