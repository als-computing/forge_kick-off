# Tiled Browse Hub

A standalone app for browsing Tiled scientific data catalogs, with two tabs:

- **Select Tabs** — choose which tabs appear in the sidebar (hub tab picker)
- **Browse** — column-browser for Tiled catalog metadata with thumbnail preview

## Architecture

```
frontend/   React + Vite app (port 5173)
            │
            └─ /api/* ──► backend (port 8002)
                              │
                              └─ tiled.client ──► Tiled server (port 8010)
```

## Quick Start

### One command (Tiled + backend + frontend)

From the repo root, use a **project virtualenv** so the `tiled` CLI matches `backend/requirements.txt` (avoids broken global installs):

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
chmod +x start_all.sh
./start_all.sh
```

This starts, in order:

1. **Tiled** at `http://127.0.0.1:8010` using `tiled/config.yml` — the repo includes a **committed** SQLite catalog and sample arrays under `.tiled/` so Browse works immediately after clone (no seed step required). See `.tiled/README.md`.
2. **Browse API** at `http://127.0.0.1:8002`
3. **Vite** at `http://127.0.0.1:5173`

The bundled catalog currently contains **five** sample datasets under `browse/generated_data/` (`gen_010005`, `gen_010006`, `gen_010007`, `gen_010011`, `gen_010021`). Add more with `backend/scripts/seed_generated_data_to_tiled.py` and commit updated `.tiled/` if you want them in the repo.

Press **Ctrl+C** to stop all three. Override the Tiled port with `TILED_PORT=8011 ./start_all.sh` if needed (update `backend/.env` accordingly).

### 1. Start the Backend

```bash
cd backend

# Create .env from the example and edit as needed
cp .env.example .env

# Install Python dependencies (Python 3.10+)
pip install -r requirements.txt

# Start the API server
uvicorn browse_server:app --host 127.0.0.1 --port 8002
```

The backend will be available at http://127.0.0.1:8002. Health check: http://127.0.0.1:8002/health

### 2. Start the Frontend

```bash
cd frontend

# Install Node dependencies (Node 18+)
npm install

# Start the Vite dev server
npm run dev
```

Open http://127.0.0.1:5173 in your browser.

## Tiled Server Configuration

By default, the backend connects to a Tiled server at `http://127.0.0.1:8010`.

Edit `backend/.env` to change the server or configure multiple named servers:

```env
# Single server
TILED_URI=http://127.0.0.1:8010
TILED_API_KEY=your-key-here

# Or multiple named servers (shown in the Browse dropdown)
TILED_SERVER_1_NAME=Local Data
TILED_SERVER_1_URI=http://127.0.0.1:8010
TILED_SERVER_1_API_KEY=

TILED_SERVER_2_NAME=Remote ALS
TILED_SERVER_2_URI=https://tiled.example.gov
TILED_SERVER_2_API_KEY=secret
```

## Frontend Environment

Create `frontend/.env.local` to override the default API base URL:

```env
VITE_API_BASE=http://127.0.0.1:8002
```

## Production Build

```bash
cd frontend
npm run build
# Output in frontend/dist/
```

## File Layout

```
test_skills/
  frontend/                 React app (Vite + TypeScript + Tailwind)
    src/
      app/
        App.tsx             Simplified hub: Select Tabs + Browse only
        pages/
          BrowsePage.tsx    Browse tab (server picker + ColumnBrowser)
          TabSelectorPage.tsx  Tab selection landing page
      components/
        Browse/             Column browser components + useBrowseData hook
        HubAppLayout.tsx    Layout shell (sidebar + header + main)
        HubSidebar.tsx      Navigation sidebar with "Select Tabs" button
        HubHeader.tsx       Top header with "Change Tabs" button
        HubMainContent.tsx  Route renderer
      stores/
        giwaxsStore.ts      Zustand store (staging, metadata keys)
      hooks/
        useHubSelectedTabs.ts  localStorage persistence for tab selection
  backend/                  FastAPI server (Python)
    browse_server.py        Five Browse endpoints + in-memory cache
    browse_helpers.py       Tiled query helpers (field mapping, distinct, search)
    tiled_config.py         Multi-server env config
    requirements.txt
    .env.example
```
