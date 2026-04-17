---
name: als-vibe-coding-kickstart
description: >
  Bootstrap a new ALS beamline science project using the canonical ALS Computing
  stack: FastAPI backend, Tiled data server, Finch-based React frontend
  (https://github.com/bluesky/finch), local git with GitHub remote, pre-commit
  hooks, and the test strategy approved by ALS Computing.
  Use this skill at the start of any new vibe-coding project, or when a participant
  asks 'how do I start a new project' or 'set up my dev environment'.
---

# ALS Vibe Coding Kickstart

This skill guides Claude Code through bootstrapping a new ALS Computing project
from a blank directory to a running, tested, version-controlled stack.
It encodes the decisions ALS Computing has already made so vibe coders don't
reinvent them.

**Before writing any code**, work through the phases below in order.
Each phase has a verification checkpoint — do not advance until it passes.

---

## Phase 0 — Project scaffold

Create the canonical directory layout:

```
<project-name>/
├── backend/               # FastAPI + Python (flat layout)
│   ├── browse_server.py   # FastAPI app entry point
│   ├── browse_helpers.py  # Tiled query helpers
│   ├── tiled_config.py    # Dynamic Tiled connection config
│   ├── scripts/           # Utility scripts (e.g. data seeding)
│   ├── requirements.txt
│   ├── .env               # NEVER committed — git-ignored
│   └── .env.example       # ALWAYS committed — placeholder values
├── frontend/              # Vite + React + TypeScript + Finch patterns + Tailwind
│   ├── src/
│   │   ├── main.tsx
│   │   └── app/App.tsx
│   ├── package.json
│   └── vite.config.ts
├── tiled/
│   └── config.yml         # Tiled server config (SQLite catalog)
├── start_all.sh           # One-command startup: Tiled + backend + frontend
├── .gitignore
├── AGENTS.md              # Claude Code rules for this project
└── README.md
```

**Create `.gitignore` immediately** with at minimum:

```
.env
__pycache__/
*.pyc
.venv/
node_modules/
dist/
.tiled/
.DS_Store
```

✅ **Checkpoint:** `git status` shows only tracked scaffold files, `.env` is absent.

---

## Phase 1 — AGENTS.md (required before any code generation)

Create `AGENTS.md` at the project root **before** asking Claude Code to write
any application code. This file governs how Claude Code behaves in this project.

Minimum required content:

```markdown
# AGENTS.md — <project-name>

## Stack
- Backend: FastAPI, Python ≥ 3.11, requirements.txt, pytest
- Data: Tiled (local SQLite catalog for dev, PostgreSQL for production)
- Frontend: Vite, React, TypeScript, Finch component patterns (https://github.com/bluesky/finch), Tailwind CSS, Zustand

## ALS Standards
Follow all rules in the ALS Dev Standards skill. Quick summary:
- Python: full type annotations, Google-style docstrings, pathlib.Path, no print()
- React: Follow Finch component conventions (HubAppLayout, HubSidebar, HubHeader, etc.)
  See https://github.com/bluesky/finch for reference patterns. Tailwind CSS for styling,
  Zustand for state. Components live in src/components/.
- Tiled: all Tiled access goes through the backend Browse API — the frontend never calls Tiled directly

## Tiled safety rules
- NEVER call Tiled write endpoints without an explicit user confirmation step in the UI
- ALL Tiled access from the frontend goes through the backend Browse API (port 8002)
- The TILED_API_KEY is read from backend/.env — never hardcode it
- start_all.sh auto-generates the key if empty and passes it via TILED_SINGLE_USER_API_KEY

## Secrets
- .env is git-ignored — never commit it
- Add new secrets to .env.example with placeholder values immediately
- If you accidentally write a secret into source code, stop and flag it

## Testing rules
- Write the test structure BEFORE implementing the feature (TDD)
- Tests must test behavior/interface, NOT implementation details
- Do not write tests that only pass because you know how the code works internally
- Backend integration tests use a live local Tiled + FastAPI server (see tests/integration/)
- Frontend: Vitest unit tests + at least one behavioral test per component

## Network safety
- NEVER bind services to 0.0.0.0 on a local dev machine
- Always use 127.0.0.1 for all local services (FastAPI, Tiled)
- FastAPI: `uvicorn browse_server:app --host 127.0.0.1 --port 8002`
- Tiled: `tiled serve config tiled/config.yml --host 127.0.0.1 --port 8010`
- Only expose ports externally when deploying to a shared server, and only after explicit confirmation

## Git
- Commit after every working increment — small, focused commits
- Commit message format: <type>(<scope>): <description>
  - Types: feat, fix, test, docs, refactor, chore
- Never commit broken code to main
```

✅ **Checkpoint:** `AGENTS.md` exists and has been read by Claude Code.

---

## Phase 2 — Backend setup

### 2a. Python environment

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
```

### 2b. `requirements.txt`

```
fastapi>=0.104.0
uvicorn[standard]>=0.24.0
tiled[all]>=0.1.0
numpy>=1.24.0
pillow>=10.0.0
python-dotenv>=1.0.0
matplotlib>=3.7.0
```

```bash
pip install -r requirements.txt
```

### 2c. FastAPI entry point

`backend/browse_server.py` — the standalone Browse API:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Tiled Browse API",
    description="Minimal Browse-only API for Tiled data exploration",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}
```

Key endpoints:
- `GET /api/config/servers` — list configured Tiled servers
- `GET /api/browse/facets` — metadata field names (live from Tiled)
- `GET /api/browse/column` — distinct values + counts for one field
- `GET /api/browse/items` — sample records matching filters
- `GET /api/browse/thumbnail` — PNG thumbnail for a Tiled array

✅ **Checkpoint:** `uvicorn browse_server:app --host 127.0.0.1 --port 8002` starts without errors.
`curl http://127.0.0.1:8002/health` returns `{"status":"ok"}`.

---

## Phase 3 — Tiled with a database

### 3a. Install and configure

```bash
pip install "tiled[server]"
```

`tiled/config.yml` (SQLite for local dev — zero ops, works offline):

```yaml
allow_origins:
  - "http://127.0.0.1:5173"
  - "http://localhost:5173"

trees:
  - path: /
    tree: tiled.catalog:from_uri
    args:
      uri: "sqlite+aiosqlite:///./.tiled/catalog.db"
      writable_storage: ".tiled/data"
      init_if_not_exists: true
```

Notes:
- `allow_origins` enables CORS for the Vite dev server.
- `writable_storage` lets the seed script write data into the catalog.
- The API key is set via the `TILED_SINGLE_USER_API_KEY` environment variable
  (see `start_all.sh`), NOT in this YAML file.

For production, swap the URI to:
```yaml
uri: "postgresql+asyncpg://user:password@localhost/tiled_db"
```
(keep the production URI in `.env`, never in `config.yml` directly)

### 3b. API key management

The project uses `TILED_SINGLE_USER_API_KEY` (an env var that Tiled reads natively)
instead of `tiled login` / `tiled api_key create`. This keeps the key stable across
restarts and avoids interactive login steps.

`start_all.sh` handles this automatically:
1. Sources `backend/.env` to read `TILED_API_KEY`.
2. If the key is empty, generates one with `secrets.token_hex(32)` and writes it
   back into `backend/.env`.
3. Starts Tiled with `TILED_SINGLE_USER_API_KEY=$TILED_API_KEY`.

The backend reads the same key from `backend/.env` via `python-dotenv`.

`backend/.env` (never committed):
```bash
TILED_URI=http://127.0.0.1:8010
TILED_API_KEY=<auto-generated or paste your own>
BROWSE_CACHE_TTL_SECONDS=300
```

`backend/.env.example` (always committed — placeholder values):
```bash
TILED_URI=http://127.0.0.1:8010
TILED_API_KEY=
BROWSE_CACHE_TTL_SECONDS=300
```

### 3c. Read the key in Python

```python
import os
from dotenv import load_dotenv

load_dotenv()

TILED_API_KEY: str = os.environ.get("TILED_API_KEY", "")
TILED_URI: str = os.environ.get("TILED_URI", "http://127.0.0.1:8010")
```

✅ **Checkpoint:** `./start_all.sh` starts Tiled on port 8010 with the key from `.env`.
`curl http://127.0.0.1:8010/?api_key=<key>` returns 200.
`git status` does NOT show `.env`.

---

## Phase 4 — Frontend setup

The frontend follows the [Finch](https://github.com/bluesky/finch) component library
architecture — the React UI framework for Bluesky beamlines. Finch provides
preconfigured layout components (`HubAppLayout`, `HubSidebar`, `HubHeader`) and the
`<Tiled>` data browser component. This project implements Finch-pattern components
locally with Vite + React + TypeScript + Tailwind CSS. State management is via Zustand.
Icons come from `@phosphor-icons/react`.

If Finch is published as `@blueskyproject/finch`, you can install it directly:
```bash
npm install @blueskyproject/finch
```
Otherwise, clone the repo and follow the Finch component conventions for layouts and pages.

### 4a. Scaffold with Vite

```bash
cd frontend
npm create vite@latest . -- --template react-ts
npm install
```

### 4b. Install dependencies

```bash
npm install react-router-dom zustand @phosphor-icons/react
npm install clsx tailwind-merge class-variance-authority
npm install -D tailwindcss postcss autoprefixer @tailwindcss/typography
npm install -D vite-tsconfig-paths
```

### 4c. Configure Tailwind

`frontend/tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

`frontend/postcss.config.js`:

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

`frontend/src/index.css` (replace contents):

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### 4d. API base configuration

All frontend API calls go through the backend Browse API (port 8002), never
directly to Tiled. The API base URL is set in `frontend/src/config.ts`:

```ts
export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002";
```

Add to `frontend/.env.local` (optional override):

```bash
VITE_API_BASE=http://127.0.0.1:8002
```

### 4e. Key architecture notes

- **Browse dropdowns** populate entirely from Tiled metadata (no hardcoded lists).
  The backend discovers facets via `container.distinct()`.
- **Facets refresh** live — the frontend polls every 30 seconds.
- **Thumbnails** for array data are generated server-side and support both
  RGB (H×W×3) and grayscale (H×W) arrays.
- **Numeric filters** auto-cast: float and int values in metadata are matched
  correctly (not as strings).

✅ **Checkpoint:** `npm run dev` starts without errors. Browser at
http://127.0.0.1:5173 shows the Browse hub with metadata columns from Tiled.

---

## Phase 5 — Git + GitHub

### 5a. Initialize local git (day one)

```bash
git init
git add .
git commit -m "chore: initial project scaffold"
```

### 5b. Commit discipline

Commit after every working increment. Use conventional commits:

```
feat(backend): add /scans endpoint returning Tiled catalog children
fix(frontend): correct Tiled URL env variable name
test(backend): add integration test for health endpoint
docs: update AGENTS.md with Tiled write safety rule
```

### 5c. GitHub remote (when ready to share)

```bash
# Create repo on GitHub (via CLI or web UI), then:
git remote add origin https://github.com/als-computing/<project-name>.git
git branch -M main
git push -u origin main
```

### 5d. Minimal GitHub Actions CI

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: pip install -r requirements.txt
        working-directory: backend
      - run: pytest
        working-directory: backend

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
        working-directory: frontend
      - run: npm run test
        working-directory: frontend
```

✅ **Checkpoint:** First push to GitHub shows green CI.

---

## Phase 6 — Pre-commit hooks (secrets + lint)

```bash
pip install pre-commit
```

`.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.4.4
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.2
    hooks:
      - id: gitleaks
        name: Detect secrets

  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: check-added-large-files
      - id: check-merge-conflict
      - id: detect-private-key
```

```bash
pre-commit install
```

This runs automatically on every `git commit`. Claude Code cannot bypass it.

✅ **Checkpoint:** `pre-commit run --all-files` passes.

---

## Phase 7 — Testing strategy

ALS Computing uses a two-layer test strategy for vibe-coded projects.

### Layer 1 — Standard unit + integration tests

**Backend (pytest):**

```python
# tests/test_health.py
import pytest
from httpx import AsyncClient, ASGITransport
from browse_server import app


@pytest.mark.asyncio
async def test_health_returns_ok() -> None:
    """Health endpoint must return status ok."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

Rules enforced by `AGENTS.md`:
- Write test structure first (TDD), then implementation.
- Test behavior and interface, not internal implementation.
- `pytest.raises` for all exception paths.
- Mock external services (Globus, SFAPI) — never call them in unit tests.

**Frontend (Vitest):**

```tsx
// src/components/ScanList.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import ScanList from "./ScanList";

describe("ScanList", () => {
  it("renders a list item for each scan", () => {
    const scans = [{ id: "scan-1", name: "Run 001" }];
    render(<ScanList scans={scans} />);
    expect(screen.getByText("Run 001")).toBeInTheDocument();
  });

  it("shows empty state when no scans are provided", () => {
    render(<ScanList scans={[]} />);
    expect(screen.getByText(/no scans/i)).toBeInTheDocument();
  });
});
```

### Layer 2 — LLM-driven behavioral tests (advanced, add after Layer 1 is stable)

The problem with LLM-written unit tests: the LLM knows the implementation, so it
can write tests that trivially pass while the behavior is wrong.

The mitigation: **LLM-as-evaluator integration tests** that run against the live
API and judge whether the *observable behavior* is correct.

Scaffold (`tests/integration/test_llm_eval.py`):

```python
"""
LLM-driven behavioral tests.

These tests call the live FastAPI + Tiled stack and use an LLM
to evaluate whether the responses are semantically correct.
They are NOT run in CI by default — trigger with: pytest -m llm_eval
"""

import os
import pytest
import httpx
import anthropic

pytestmark = pytest.mark.llm_eval

BASE_URL = os.environ.get("TEST_BASE_URL", "http://localhost:8002")


@pytest.fixture(scope="module")
def llm() -> anthropic.Anthropic:
    return anthropic.Anthropic()


def llm_judge(llm: anthropic.Anthropic, question: str, response_json: dict) -> bool:
    """Ask an LLM whether an API response correctly answers a behavioral question.

    Args:
        llm: Anthropic client.
        question: Plain-English behavioral assertion to evaluate.
        response_json: The actual API response to evaluate.

    Returns:
        True if the LLM judges the response as correct.
    """
    result = llm.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=64,
        messages=[{
            "role": "user",
            "content": (
                f"API response: {response_json}\n\n"
                f"Question: {question}\n\n"
                "Answer only YES or NO."
            ),
        }],
    )
    return result.content[0].text.strip().upper().startswith("YES")


@pytest.mark.asyncio
async def test_scan_list_contains_scan_id(llm: anthropic.Anthropic) -> None:
    """Scans endpoint must return a list that includes a scan identifier."""
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        response = await client.get("/scans")
    assert response.status_code == 200
    assert llm_judge(
        llm,
        "Does this response contain a list with at least one item that has an id field?",
        response.json(),
    )
```

Run LLM eval tests:
```bash
pytest -m llm_eval --tb=short
```

Skip them in normal CI (already handled by the `llm_eval` mark).

✅ **Checkpoint:** `pytest` (Layer 1) passes. `pytest -m llm_eval` can be run manually
against a live server.

---

## Quick-start checklist for workshop participants

Copy this into your project's `README.md`:

```markdown
## Development setup

- [ ] Phase 0: scaffold created, `.gitignore` committed
- [ ] Phase 1: `AGENTS.md` written and in place
- [ ] Phase 2: FastAPI backend running, `/health` returns 200
- [ ] Phase 3: Tiled running with SQLite, API key in `.env`
- [ ] Phase 4: Finch-based React frontend running, Browse tab shows Tiled metadata
- [ ] Phase 5: `git init` done, first commit made
- [ ] Phase 6: pre-commit hooks installed and passing
- [ ] Phase 7: at least one pytest test and one Vitest test passing
```

---

## Common mistakes to avoid

| Mistake | Correct approach |
|---|---|
| Raw `fetch`/`axios` to Tiled from the frontend | Route all Tiled access through the backend Browse API; for direct Tiled UI use the Finch `<Tiled>` component |
| Hardcoded API key in source | `.env` file, read via `python-dotenv` |
| Committing `.env` | It's in `.gitignore`; pre-commit gitleaks will also catch it |
| Binding to `0.0.0.0` locally | Always use `127.0.0.1` — never expose ports on a dev machine |
| Writing tests after the feature | Write test structure first, then implement |
| Tests that verify internal logic | Test observable behavior and API contracts |
| `print()` for debugging | `logging.getLogger(__name__)` |
| One giant commit at the end | Small commits after each working increment |
| Skipping `AGENTS.md` | Required before any code generation — it governs Claude Code |
