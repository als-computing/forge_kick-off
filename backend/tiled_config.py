"""
Dynamic Tiled Server Configuration
Allows runtime configuration of Tiled server URI and API key.
"""

import os
from typing import Optional, Callable, List, Dict, Any
from dotenv import load_dotenv

# Load .env for defaults
load_dotenv()


def get_tiled_servers() -> Dict[str, Dict[str, Any]]:
    """Load configured Tiled servers from environment.

    Reads TILED_SERVER_1_NAME, TILED_SERVER_1_URI, TILED_SERVER_1_API_KEY, etc.
    If none set, returns only Local Data (port 8010) using TILED_API_KEY from .env.

    Returns:
        Dict mapping server name to {"uri": str, "api_key": Optional[str]}
    """
    servers = {}
    server_num = 1
    while True:
        name = (os.getenv(f"TILED_SERVER_{server_num}_NAME") or "").strip()
        uri = (os.getenv(f"TILED_SERVER_{server_num}_URI") or "").strip().rstrip("/")
        if not name or not uri:
            break
        api_key = (os.getenv(f"TILED_SERVER_{server_num}_API_KEY") or "").strip() or None
        servers[name] = {"uri": uri, "api_key": api_key}
        server_num += 1

    if not servers:
        # Default: Local Data (8010) with .env API key
        local_api_key = os.getenv("TILED_LOCAL_API_KEY", "") or os.getenv("TILED_API_KEY", "")
        local_api_key = local_api_key.strip() if local_api_key else None
        servers["Local Data (port 8010)"] = {
            "uri": "http://127.0.0.1:8010",
            "api_key": local_api_key,
        }

    # Ensure Local Data (port 8010) is always present
    _local_uri = "http://127.0.0.1:8010"
    has_8010 = any(
        (c.get("uri") or "").rstrip("/").endswith("8010") for c in servers.values()
    )
    if not has_8010:
        local_key = os.getenv("TILED_LOCAL_API_KEY", "") or os.getenv("TILED_API_KEY", "")
        servers["Local Data (port 8010)"] = {
            "uri": _local_uri,
            "api_key": (local_key.strip() or None) if local_key else None,
        }

    return servers

# Global configuration (can be updated at runtime)
# For local server (8010), prefer TILED_LOCAL_API_KEY; for others use TILED_API_KEY
_local_key = os.getenv("TILED_LOCAL_API_KEY", "")
_default_key = os.getenv("TILED_API_KEY", "")
_tiled_config = {
    "uri": os.getenv("TILED_URI", "http://127.0.0.1:8010"),
    "api_key": _local_key if _local_key else _default_key,
}

# Timeout configuration
TILED_TIMEOUT = int(os.getenv("TILED_TIMEOUT", "30"))

# Cache invalidation callbacks
_cache_invalidation_callbacks: List[Callable[[], None]] = []


def register_cache_invalidation_callback(callback: Callable[[], None]) -> None:
    """Register a callback to be called when the server configuration changes.
    
    This allows modules like tools.py to register their cache invalidation functions.
    
    Args:
        callback: A function that takes no arguments and invalidates a cache
    """
    if callback not in _cache_invalidation_callbacks:
        _cache_invalidation_callbacks.append(callback)


def _invalidate_all_caches() -> None:
    """Call all registered cache invalidation callbacks."""
    for callback in _cache_invalidation_callbacks:
        try:
            callback()
        except Exception:
            pass  # Don't let one failing callback break others


def set_tiled_server(uri: str, api_key: Optional[str] = None) -> None:
    """Set the Tiled server configuration dynamically.
    
    Args:
        uri: Tiled server URI (e.g., "https://tiled-demo.nsls2.bnl.gov")
        api_key: Optional API key (None or empty string means no auth)
    """
    global _tiled_config
    
    # Check if configuration actually changed
    old_uri = _tiled_config["uri"]
    old_key = _tiled_config["api_key"]
    
    _tiled_config["uri"] = uri.strip().rstrip("/") if uri else uri
    _tiled_config["api_key"] = api_key if api_key else None
    
    # Invalidate caches if configuration changed
    if old_uri != uri or old_key != _tiled_config["api_key"]:
        _invalidate_all_caches()


def get_tiled_config() -> dict:
    """Get the current Tiled server configuration.
    
    Returns:
        dict with 'uri' and 'api_key' keys
    """
    return _tiled_config.copy()


def get_tiled_url() -> str:
    """Get the Tiled API URL (base URI + /api/v1)."""
    return f"{_tiled_config['uri']}/api/v1"


def get_tiled_base() -> str:
    """Get the Tiled base URI."""
    return _tiled_config["uri"]


def get_tiled_api_key() -> Optional[str]:
    """Get the Tiled API key."""
    return _tiled_config.get("api_key")


def get_auth_headers() -> dict:
    """Get authorization headers for Tiled API requests."""
    headers = {}
    api_key = _tiled_config.get("api_key")
    if api_key:
        headers["Authorization"] = f"Apikey {api_key}"
    return headers


def get_timeout() -> int:
    """Get the configured timeout for Tiled requests."""
    return TILED_TIMEOUT
