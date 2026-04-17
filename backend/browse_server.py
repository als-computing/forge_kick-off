"""
Standalone Browse API Server for Tiled data exploration.

Exposes only the Browse-related endpoints:
  GET /api/config/servers   — list configured Tiled servers
  GET /api/browse/facets    — metadata field names available for browsing
  GET /api/browse/column    — distinct values + counts for one field (with upstream filters)
  GET /api/browse/items     — sample records matching a set of filters
  GET /api/browse/thumbnail — PNG thumbnail for a Tiled array path

Run:
  uvicorn browse_server:app --host 127.0.0.1 --port 8002
"""

import asyncio
import json
import logging
import os
import time as _time
from typing import Dict, Any, List, Optional, Tuple

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from tiled_config import (
    get_tiled_servers,
    get_tiled_base,
    get_tiled_api_key,
)
from browse_helpers import (
    build_field_mapping,
    tiled_distinct_values,
    tiled_search_items,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("browse-server")

app = FastAPI(
    title="Tiled Browse API",
    description="Minimal Browse-only API for Tiled data exploration",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class ServerConfig(BaseModel):
    name: str
    uri: str
    has_api_key: bool
    api_key: Optional[str] = None


# ---------------------------------------------------------------------------
# Tiled client helpers
# ---------------------------------------------------------------------------

_tiled_client_cache: Dict[Tuple, Any] = {}


def _api_key_for_uri(uri: Optional[str]) -> Optional[str]:
    """Look up the API key for a given server URI from the server list."""
    if not uri:
        return None
    servers = get_tiled_servers()
    for cfg in servers.values():
        if (cfg.get("uri") or "").rstrip("/") == uri.rstrip("/"):
            return cfg.get("api_key")
    return None


def _get_tiled_client(server_uri: Optional[str] = None, server_api_key: Optional[str] = None):
    """Return a tiled.client connected to the requested server, with connection pooling."""
    from tiled.client import from_uri

    uri = (server_uri or get_tiled_base()).rstrip("/")
    api_key = server_api_key or _api_key_for_uri(uri) or get_tiled_api_key()
    cache_key = (uri, api_key or "")
    if cache_key in _tiled_client_cache:
        return _tiled_client_cache[cache_key]

    kwargs: Dict[str, Any] = {}
    if api_key:
        kwargs["api_key"] = api_key
    client = from_uri(uri, **kwargs)
    _tiled_client_cache[cache_key] = client
    return client


def _get_browse_container(client, technique: str):
    """Return (container_node, path_prefix) for the Metadata Browser.

    Walks known beamline locations in priority order and returns the first
    container that exists.
    """
    _CANDIDATES = [
        (["browse", "generated_data"], "browse/generated_data"),
        (["beamlines", "bl733", "projects", "10k"], "beamlines/bl733/projects/10k"),
        (["beamlines", "bl733"], "beamlines/bl733"),
        (["beamlines", "bl901"], "beamlines/bl901"),
    ]
    for keys, prefix in _CANDIDATES:
        try:
            node = client
            for k in keys:
                node = node[k]
            if len(node) > 0:
                return node, prefix
        except (KeyError, TypeError):
            continue
    return client, ""


# ---------------------------------------------------------------------------
# In-memory cache (5-minute TTL)
# ---------------------------------------------------------------------------

_CACHE_TTL = int(os.getenv("BROWSE_CACHE_TTL_SECONDS", "300"))
_CACHE_MAX = 100
_cache: Dict[str, Tuple[float, Any]] = {}
_field_mapping_cache: Dict[Tuple, Tuple] = {}
_FIELD_MAPPING_CACHE_TTL = 300


def _cache_key(endpoint: str, **params) -> str:
    parts = [endpoint] + [f"{k}={v}" for k, v in sorted(params.items())]
    return "|".join(parts)


def _get_cached(key: str) -> Optional[Any]:
    entry = _cache.get(key)
    if entry and _time.time() < entry[0]:
        return entry[1]
    return None


def _set_cached(key: str, value: Any) -> None:
    now = _time.time()
    _cache[key] = (now + _CACHE_TTL, value)
    if len(_cache) > _CACHE_MAX:
        oldest = min(_cache, key=lambda k: _cache[k][0])
        _cache.pop(oldest, None)


def _get_field_mapping(
    server_uri: str,
    technique: str,
    server_api_key: Optional[str] = None,
    force_refresh: bool = False,
) -> dict:
    """Return cached field mapping, refreshing if stale."""
    now = _time.time()
    cache_key = (server_uri, technique)
    if not force_refresh:
        entry = _field_mapping_cache.get(cache_key)
        if entry and now < entry[0]:
            return entry[1]

    client = _get_tiled_client(server_uri or None, server_api_key)
    container, _ = _get_browse_container(client, technique)
    mapping = build_field_mapping(container)
    _field_mapping_cache[cache_key] = (now + _FIELD_MAPPING_CACHE_TTL, mapping)
    return mapping


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/config/servers", response_model=List[ServerConfig])
async def get_servers():
    """List Tiled servers. Local Data (port 8010) first."""
    servers = get_tiled_servers()
    items = [
        ServerConfig(
            name=name,
            uri=cfg["uri"],
            has_api_key=bool(cfg.get("api_key")),
            api_key=cfg.get("api_key"),
        )
        for name, cfg in servers.items()
    ]
    local = next((s for s in items if "8010" in (s.uri or "")), None)
    if local and items and items[0] != local:
        items = [local] + [s for s in items if s != local]
    return items


@app.get("/api/browse/facets")
async def browse_facets(
    server_uri: Optional[str] = None,
    server_api_key: Optional[str] = None,
    technique: str = Query("GIWAXS"),
    refresh: bool = Query(False),
):
    """Return ordered list of browsable metadata fields discovered live from Tiled distinct()."""
    def _discover():
        client = _get_tiled_client(server_uri, server_api_key)
        container, _ = _get_browse_container(client, technique)
        mapping = build_field_mapping(container)

        cache_key = (server_uri or "", technique)
        _field_mapping_cache[cache_key] = (_time.time() + _FIELD_MAPPING_CACHE_TTL, mapping)

        facets = []
        techniques_seen: list[str] = []
        for disp_key in mapping["all_display_keys"]:
            raw_key = mapping["display_to_raw"].get(disp_key, disp_key)
            try:
                result = container.distinct(raw_key, counts=True)
                vals = result.get("metadata", {}).get(raw_key, [])
                non_null = [
                    v for v in vals
                    if v.get("value") is not None
                    and str(v["value"]).strip() not in ("", "None", "NaN", "nan")
                ]
                if len(non_null) >= 2:
                    facets.append(disp_key)
                if disp_key in ("technique", "scan_type"):
                    for v in non_null:
                        sv = str(v["value"]).strip()
                        if sv and sv not in techniques_seen:
                            techniques_seen.append(sv)
            except Exception:
                continue

        return {"facets": facets, "techniques": techniques_seen}

    try:
        result = await asyncio.to_thread(_discover)
        return result
    except Exception as e:
        logger.warning("browse_facets failed: %s", e)
        return {"facets": [], "techniques": []}


@app.get("/api/browse/column")
async def browse_column(
    server_uri: Optional[str] = None,
    server_api_key: Optional[str] = None,
    technique: str = Query("GIWAXS"),
    field: str = Query(..., description="Display-key metadata field to group by"),
    filters: str = Query("{}", description="JSON dict of upstream display_key=value selections"),
    limit: int = Query(500, ge=1, le=5000),
    refresh: bool = Query(False),
):
    """Return distinct values (+ counts) for *field* using Tiled distinct() + search()."""
    try:
        filter_dict = json.loads(filters)
    except Exception:
        filter_dict = {}

    key = _cache_key(
        "browse-column",
        server_uri=server_uri or "",
        technique=technique,
        field=field,
        filters=filters,
        limit=limit,
    )
    if not refresh:
        cached = _get_cached(key)
        if cached is not None:
            return cached

    def _build():
        client = _get_tiled_client(server_uri, server_api_key)
        container, _ = _get_browse_container(client, technique)

        cache_key = (server_uri or "", technique)
        entry = _field_mapping_cache.get(cache_key)
        if entry and _time.time() < entry[0]:
            mapping = entry[1]
        else:
            mapping = build_field_mapping(container)
            _field_mapping_cache[cache_key] = (_time.time() + _FIELD_MAPPING_CACHE_TTL, mapping)

        raw_key = mapping["display_to_raw"].get(field, field)
        return tiled_distinct_values(
            container, raw_key,
            filters=filter_dict,
            field_mapping=mapping,
            limit=limit,
        )

    try:
        result = await asyncio.to_thread(_build)
        _set_cached(key, result)
        return result
    except Exception as e:
        raise HTTPException(502, f"Failed to browse column: {e}")


@app.get("/api/browse/items")
async def browse_items(
    server_uri: Optional[str] = None,
    server_api_key: Optional[str] = None,
    technique: str = Query("GIWAXS"),
    filters: str = Query("{}", description="JSON dict of display_key=value selections"),
    limit: int = Query(500, ge=1, le=2000),
    refresh: bool = Query(False),
):
    """Return sample records (path + metadata) matching *filters* using Tiled search()."""
    try:
        filter_dict = json.loads(filters)
    except Exception:
        filter_dict = {}

    key = _cache_key(
        "browse-items",
        server_uri=server_uri or "",
        technique=technique,
        filters=filters,
        limit=limit,
    )
    if not refresh:
        cached = _get_cached(key)
        if cached is not None:
            return cached

    def _build():
        client = _get_tiled_client(server_uri, server_api_key)
        container, prefix = _get_browse_container(client, technique)

        cache_key = (server_uri or "", technique)
        entry = _field_mapping_cache.get(cache_key)
        if entry and _time.time() < entry[0]:
            mapping = entry[1]
        else:
            mapping = build_field_mapping(container)
            _field_mapping_cache[cache_key] = (_time.time() + _FIELD_MAPPING_CACHE_TTL, mapping)

        return tiled_search_items(
            container,
            filters=filter_dict,
            field_mapping=mapping,
            limit=limit,
            container_path_prefix=prefix,
        )

    try:
        result = await asyncio.to_thread(_build)
        _set_cached(key, result)
        return result
    except Exception as e:
        raise HTTPException(502, f"Failed to browse items: {e}")


@app.get("/api/browse/thumbnail")
async def browse_thumbnail(
    tiled_path: str = Query(..., description="Slash-separated Tiled path"),
    server_uri: Optional[str] = None,
    server_api_key: Optional[str] = None,
    size: int = Query(256, ge=32, le=512),
):
    """Return a PNG thumbnail for the first raw-array child at *tiled_path*."""
    import numpy as np
    from io import BytesIO
    try:
        from PIL import Image as PILImage
    except ImportError:
        raise HTTPException(503, "Pillow is required for thumbnails")

    def _build_thumbnail():
        api_key = server_api_key or _api_key_for_uri(server_uri) or None
        client = _get_tiled_client(server_uri, api_key)

        node = client
        for part in tiled_path.strip("/").split("/"):
            node = node[part]

        is_array = hasattr(node, "read")
        if not is_array:
            children = list(node)
            raw_children = [
                k for k in children
                if not k.endswith("_qmap") and hasattr(node[k], "read")
            ]
            if not raw_children:
                return None
            node = node[raw_children[0]]

        arr = np.asarray(node.read())
        arr = np.squeeze(arr)

        # --- RGB array (H×W×3 or H×W×4): render directly ---
        if arr.ndim == 3 and arr.shape[2] in (3, 4):
            rgb = arr[:, :, :3]
            if rgb.dtype != np.uint8:
                lo, hi = rgb.min(), rgb.max()
                if hi > lo:
                    rgb = ((rgb - lo) / (hi - lo) * 255).astype(np.uint8)
                else:
                    rgb = np.zeros_like(rgb, dtype=np.uint8)
            h, w = rgb.shape[:2]
            scale = min(size / h, size / w, 1.0)
            nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
            img = PILImage.fromarray(rgb).resize((nw, nh), PILImage.Resampling.LANCZOS)
            buf = BytesIO()
            img.save(buf, format="PNG")
            return buf.getvalue()

        # --- Grayscale / intensity array (H×W): apply viridis colormap ---
        if arr.ndim != 2:
            return None

        arr = arr.astype(np.float64)
        arr = np.nan_to_num(arr, nan=0.0, posinf=0.0, neginf=0.0)
        arr = np.log1p(np.maximum(arr, 0))
        lo, hi = np.nanmin(arr), np.nanmax(arr)
        if hi > lo:
            arr = (arr - lo) / (hi - lo)
        else:
            arr = np.zeros_like(arr)
        arr = np.clip(arr, 0, 1)

        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            cmap = plt.get_cmap("viridis")
            rgb = (cmap(arr)[:, :, :3] * 255).astype(np.uint8)
        except Exception:
            gray = (arr * 255).astype(np.uint8)
            rgb = np.stack([gray, gray, gray], axis=-1)

        h, w = rgb.shape[:2]
        scale = min(size / h, size / w, 1.0)
        nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
        img = PILImage.fromarray(rgb).resize((nw, nh), PILImage.Resampling.LANCZOS)

        buf = BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    try:
        png_bytes = await asyncio.get_event_loop().run_in_executor(None, _build_thumbnail)
    except Exception as e:
        raise HTTPException(502, f"Failed to load array from Tiled: {e}")

    if png_bytes is None:
        raise HTTPException(404, "No array data found at the given path")

    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=300"},
    )


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8002)
