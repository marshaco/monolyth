FastAPI backend. Routes are mounted under `/v1`, and nginx proxies `/api/v1/*` here, leaving other `/api/*` paths to Next.js.

- `GET /v1/health`: liveness plus a DB check
- `GET /v1/holdings`, `POST /v1/holdings`, `DELETE /v1/holdings/{ticker}`: the current user's manually added holdings

Auth is a stub for now: every request is a single local dev user (`auth.py`), until Clerk is wired up.

Run: `uv run uvicorn main:app --reload` (interactive docs at `/docs`). Tests: `uv run pytest` from the repo root.
