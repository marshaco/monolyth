#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colours
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

log()  { echo -e "${CYAN}[dev]${NC} $*"; }
ok()   { echo -e "${GREEN}[dev]${NC} $*"; }
warn() { echo -e "${YELLOW}[dev]${NC} $*"; }
err()  { echo -e "${RED}[dev]${NC} $*"; }

PIDS=()

cleanup() {
  echo ""
  log "Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  ok "All services stopped."
}
trap cleanup EXIT INT TERM

# ── Kill stale processes from previous runs ──────────────────────────────────
pkill -f "next dev" 2>/dev/null || true
pkill -f "uvicorn main:app" 2>/dev/null || true
pkill -f "celery -A worker" 2>/dev/null || true
sleep 1

# ── 1. Infrastructure (Docker) ──────────────────────────────────────────────
log "Starting infrastructure (Docker)..."
if docker compose -f "$ROOT/infra/docker-compose.yml" up -d; then
  ok "Infrastructure up."
else
  err "Docker failed to start — is Docker running?"
fi

# ── 2. FastAPI backend ───────────────────────────────────────────────────────
API_DIR="$ROOT/apps/api"
if [ -f "$API_DIR/main.py" ]; then
  log "Starting FastAPI backend..."
  (cd "$API_DIR" && uvicorn main:app --reload --port 8000 2>&1 || true) | sed "s/^/$(echo -e "${YELLOW}[api]${NC}") /" &
  PIDS+=($!)
  ok "FastAPI started (PID ${PIDS[-1]})."
else
  warn "apps/api/main.py not found — skipping API."
fi

# ── 3. Celery worker ─────────────────────────────────────────────────────────
SYNC_DIR="$ROOT/services/sync"
if [ -f "$SYNC_DIR/worker.py" ]; then
  log "Starting Celery worker..."
  (cd "$SYNC_DIR" && celery -A worker worker --loglevel=info 2>&1 || true) | sed "s/^/$(echo -e "${CYAN}[celery]${NC}") /" &
  PIDS+=($!)
  ok "Celery started (PID ${PIDS[-1]})."
else
  warn "services/sync/worker.py not found — skipping Celery."
fi

# ── 4. Next.js frontend ──────────────────────────────────────────────────────
WEB_DIR="$ROOT/apps/web"
if [ -f "$WEB_DIR/package.json" ]; then
  log "Starting Next.js frontend..."
  (cd "$WEB_DIR" && npm run dev 2>&1 || true) | sed "s/^/$(echo -e "${GREEN}[web]${NC}") /" &
  PIDS+=($!)
  ok "Next.js started (PID ${PIDS[-1]})."
else
  err "apps/web/package.json not found — cannot start frontend."
fi

echo ""
ok "All services running. Press Ctrl+C to stop."
echo ""

wait
