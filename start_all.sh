#!/usr/bin/env bash
# start_all.sh — Start Tiled, Browse backend, and frontend together.
# Usage: ./start_all.sh
# Stop everything: Ctrl+C

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
TILED_CONFIG="$SCRIPT_DIR/tiled/config.yml"
TILED_PORT="${TILED_PORT:-8010}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

# Prefer repo venv Python/tiled if present
if [ -x "$SCRIPT_DIR/.venv/bin/python" ]; then
  PYTHON="$SCRIPT_DIR/.venv/bin/python"
elif [ -x "$BACKEND_DIR/.venv/bin/python" ]; then
  PYTHON="$BACKEND_DIR/.venv/bin/python"
else
  PYTHON="${PYTHON:-python3}"
fi

tiled_cmd() {
  if [ -x "$SCRIPT_DIR/.venv/bin/tiled" ]; then
    "$SCRIPT_DIR/.venv/bin/tiled" "$@"
  elif command -v tiled &>/dev/null; then
    tiled "$@"
  else
    "$PYTHON" -m tiled "$@"
  fi
}

cleanup() {
  echo ""
  echo -e "${YELLOW}Shutting down...${NC}"
  kill "$TILED_PID" "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  wait "$TILED_PID" "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  echo -e "${GREEN}Done.${NC}"
  exit 0
}
trap cleanup SIGINT SIGTERM

# ---------------------------------------------------------------------------
# Load .env — create it from .env.example if missing
# ---------------------------------------------------------------------------
if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo -e "${YELLOW}    No .env found — copying from .env.example${NC}"
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
fi

set -a
# shellcheck source=/dev/null
source "$BACKEND_DIR/.env"
set +a

# Generate a stable API key if TILED_API_KEY is empty or missing
if [ -z "${TILED_API_KEY:-}" ]; then
  TILED_API_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
  # Persist it back into .env so it survives restarts
  if grep -q "^TILED_API_KEY=" "$BACKEND_DIR/.env"; then
    sed -i.bak "s|^TILED_API_KEY=.*|TILED_API_KEY=${TILED_API_KEY}|" "$BACKEND_DIR/.env" && rm -f "$BACKEND_DIR/.env.bak"
  else
    echo "TILED_API_KEY=${TILED_API_KEY}" >> "$BACKEND_DIR/.env"
  fi
  echo -e "${YELLOW}    Generated new TILED_API_KEY and saved to backend/.env${NC}"
fi
export TILED_API_KEY

# ---------------------------------------------------------------------------
# Tiled (must match backend/tiled_config.py default: port 8010)
# ---------------------------------------------------------------------------
echo -e "${CYAN}==> Starting Tiled (port ${TILED_PORT})...${NC}"

if [ ! -f "$TILED_CONFIG" ]; then
  echo -e "${RED}Error: missing $TILED_CONFIG${NC}"
  exit 1
fi

mkdir -p "$SCRIPT_DIR/.tiled"
if [ ! -f "$SCRIPT_DIR/.tiled/catalog.db" ]; then
  echo -e "${YELLOW}    Initializing Tiled catalog (first run)...${NC}"
  (cd "$SCRIPT_DIR" && TILED_SINGLE_USER_API_KEY="$TILED_API_KEY" tiled_cmd catalog init --if-not-exists \
    "sqlite+aiosqlite:///./.tiled/catalog.db") || {
    echo -e "${RED}    Tiled catalog init failed. Install: pip install 'tiled[server]'${NC}"
    exit 1
  }
fi

(cd "$SCRIPT_DIR" && TILED_SINGLE_USER_API_KEY="$TILED_API_KEY" tiled_cmd serve config "$TILED_CONFIG" --host 127.0.0.1 --port "$TILED_PORT") &
TILED_PID=$!
echo -e "${GREEN}    Tiled PID: $TILED_PID${NC}"

echo -e "${CYAN}    Waiting for Tiled...${NC}"
TILED_READY=0
for i in $(seq 1 40); do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:${TILED_PORT}/" 2>/dev/null || echo "000")
  if [[ "$code" =~ ^(200|301|302|401|403|404)$ ]]; then
    echo -e "${GREEN}    Tiled ready at http://127.0.0.1:${TILED_PORT}${NC}"
    TILED_READY=1
    break
  fi
  if ! kill -0 "$TILED_PID" 2>/dev/null; then
    echo -e "${RED}    Tiled failed to start. Install: pip install 'tiled[server]' (see backend/requirements.txt).${NC}"
    exit 1
  fi
  sleep 0.5
done
if [ "$TILED_READY" != 1 ]; then
  echo -e "${RED}    Tiled did not become ready in time (http code: ${code:-unknown}).${NC}"
  exit 1
fi

# ---------------------------------------------------------------------------
# Backend
# ---------------------------------------------------------------------------
echo -e "${CYAN}==> Starting backend (port 8002)...${NC}"

UVICORN_CMD=(uvicorn)
if [ -x "$SCRIPT_DIR/.venv/bin/uvicorn" ]; then
  UVICORN_CMD=("$SCRIPT_DIR/.venv/bin/uvicorn")
elif ! command -v uvicorn &>/dev/null; then
  echo -e "${RED}Error: uvicorn not found. Run: python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt${NC}"
  exit 1
fi

cd "$BACKEND_DIR"
"${UVICORN_CMD[@]}" browse_server:app --host 127.0.0.1 --port 8002 &
BACKEND_PID=$!
echo -e "${GREEN}    Backend PID: $BACKEND_PID${NC}"

echo -e "${CYAN}    Waiting for backend...${NC}"
for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1:8002/health >/dev/null 2>&1; then
    echo -e "${GREEN}    Backend ready at http://127.0.0.1:8002${NC}"
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo -e "${RED}    Backend failed to start. Check logs above.${NC}"
    exit 1
  fi
  sleep 0.5
done

# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------
echo -e "${CYAN}==> Starting frontend (port 5173)...${NC}"

cd "$FRONTEND_DIR"

if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}    node_modules not found — running npm install...${NC}"
  npm install
fi

npm run dev -- --host 127.0.0.1 &
FRONTEND_PID=$!
echo -e "${GREEN}    Frontend PID: $FRONTEND_PID${NC}"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN}  Tiled Browse Hub is running!${NC}"
echo -e "${GREEN}  Tiled    : http://127.0.0.1:${TILED_PORT}${NC}"
echo -e "${GREEN}  Frontend : http://127.0.0.1:5173${NC}"
echo -e "${GREEN}  Backend  : http://127.0.0.1:8002${NC}"
echo -e "${GREEN}  Press Ctrl+C to stop all servers.${NC}"
echo -e "${GREEN}==========================================${NC}"
echo ""

wait
