Shared database package (`monolyth_db`): SQLAlchemy 2.0 models, Alembic migrations and the session factory, used by `apps/api` and later the `services/*` workers. Postgres with the `pgvector` extension (enabled in the first migration) for semantic search over filings.

- `src/monolyth_db/models.py`: `User` (linked to Clerk by `clerk_user_id`) and `Holding` (the unified holdings schema)
- `src/monolyth_db/session.py`: `get_engine()` and `get_session()` (also usable as a FastAPI dependency)
- `src/monolyth_db/migrations/`: Alembic; run `uv run alembic upgrade head` from this directory

The connection string comes from `DATABASE_URL`, defaulting to the docker-compose Postgres (`localhost:5433`).
