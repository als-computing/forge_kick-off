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
ENV_DIR=""
ENV_KIND=""
CONDA_ENV_DIR="$SCRIPT_DIR/.conda-py312"
REQUIRED_PYTHON_MAJOR=3
REQUIRED_PYTHON_MINOR=12

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

BOOTSTRAP_PYTHON=""
CONDA_MANAGER=""

python_matches_required() {
  local python_bin="$1"
  "$python_bin" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (${REQUIRED_PYTHON_MAJOR}, ${REQUIRED_PYTHON_MINOR}) else 1)"
}

find_conda_manager() {
  if command -v micromamba >/dev/null 2>&1; then
    CONDA_MANAGER="$(command -v micromamba)"
  elif command -v mamba >/dev/null 2>&1; then
    CONDA_MANAGER="$(command -v mamba)"
  elif command -v conda >/dev/null 2>&1; then
    CONDA_MANAGER="$(command -v conda)"
  else
    CONDA_MANAGER=""
  fi
}

select_bootstrap_python() {
  if [ -n "${PYTHON:-}" ]; then
    BOOTSTRAP_PYTHON="$PYTHON"
  elif command -v python3.12 >/dev/null 2>&1; then
    BOOTSTRAP_PYTHON="$(command -v python3.12)"
  elif command -v python3 >/dev/null 2>&1; then
    BOOTSTRAP_PYTHON="$(command -v python3)"
  elif command -v python >/dev/null 2>&1; then
    BOOTSTRAP_PYTHON="$(command -v python)"
  else
    echo -e "${RED}Error: Python ${REQUIRED_PYTHON_MAJOR}.${REQUIRED_PYTHON_MINOR} is required but no Python interpreter was found.${NC}"
    exit 1
  fi

  if ! python_matches_required "$BOOTSTRAP_PYTHON"; then
    echo -e "${RED}Error: Python ${REQUIRED_PYTHON_MAJOR}.${REQUIRED_PYTHON_MINOR} is required for the venv fallback because newer interpreters currently miss some binary wheels.${NC}"
    echo -e "${RED}Install python3.12, use micromamba/mamba/conda, or set PYTHON=/path/to/python3.12.${NC}"
    exit 1
  fi
}

ensure_python_version() {
  local python_bin="$1"
  local env_label="$2"
  if ! python_matches_required "$python_bin"; then
    echo -e "${RED}Error: existing ${env_label} at $ENV_DIR uses $("$python_bin" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")') but ${REQUIRED_PYTHON_MAJOR}.${REQUIRED_PYTHON_MINOR} is required.${NC}"
    echo -e "${RED}Remove $ENV_DIR and rerun, or let the script create a new managed environment.${NC}"
    exit 1
  fi
}

create_conda_env() {
  ENV_DIR="$CONDA_ENV_DIR"
  ENV_KIND="conda"
  echo -e "${YELLOW}    Creating project conda environment at $ENV_DIR with $(basename "$CONDA_MANAGER")${NC}"
  "$CONDA_MANAGER" create -y -p "$ENV_DIR" "python=${REQUIRED_PYTHON_MAJOR}.${REQUIRED_PYTHON_MINOR}" pip
}

create_venv_env() {
  select_bootstrap_python
  ENV_DIR="$SCRIPT_DIR/.venv"
  ENV_KIND="venv"
  echo -e "${YELLOW}    Creating project virtualenv at $ENV_DIR${NC}"
  "$BOOTSTRAP_PYTHON" -m venv "$ENV_DIR"
}

ensure_backend_env() {
  find_conda_manager

  if [ -x "$CONDA_ENV_DIR/bin/python" ]; then
    ENV_DIR="$CONDA_ENV_DIR"
    ENV_KIND="conda"
  elif [ -x "$SCRIPT_DIR/.venv/bin/python" ]; then
    ENV_DIR="$SCRIPT_DIR/.venv"
    ENV_KIND="venv"
  elif [ -x "$BACKEND_DIR/.venv/bin/python" ]; then
    ENV_DIR="$BACKEND_DIR/.venv"
    ENV_KIND="venv"
  elif [ -n "$CONDA_MANAGER" ]; then
    create_conda_env
  else
    create_venv_env
  fi

  PYTHON="$ENV_DIR/bin/python"
  ensure_python_version "$PYTHON" "$ENV_KIND environment"
  PIP_CMD=("$PYTHON" -m pip)

  if ! "$PYTHON" -c "import tiled, uvicorn" >/dev/null 2>&1; then
    echo -e "${YELLOW}    Installing backend dependencies into $ENV_DIR${NC}"
    "${PIP_CMD[@]}" install -r "$BACKEND_DIR/requirements.txt"
  fi
}

tiled_cmd() {
  if [ -x "$ENV_DIR/bin/tiled" ]; then
    "$ENV_DIR/bin/tiled" "$@"
  elif command -v tiled &>/dev/null; then
    tiled "$@"
  else
    echo -e "${RED}Error: tiled CLI not found in $ENV_DIR or on PATH.${NC}"
    echo -e "${RED}Run the script again after environment bootstrap succeeds, or install dependencies into $ENV_DIR.${NC}"
    exit 1
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

ensure_backend_env

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
  TILED_API_KEY=$("$PYTHON" -c "import secrets; print(secrets.token_hex(32))")
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

UVICORN_CMD=("$ENV_DIR/bin/uvicorn")
if [ ! -x "${UVICORN_CMD[0]}" ]; then
  echo -e "${RED}Error: uvicorn not found in $ENV_DIR.${NC}"
  echo -e "${RED}Run: $PYTHON -m pip install -r backend/requirements.txt${NC}"
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
