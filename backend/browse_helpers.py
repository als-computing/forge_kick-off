"""
Browse helpers extracted from the tiled-agentic graph_builder.py.

Provides only what the Browse API endpoints need:
  - DISPLAY_KEY_ALIASES   — thinfilm_ prefix alias mapping (display names only)
  - build_field_mapping() — introspect a Tiled container for metadata keys
  - tiled_distinct_values() — distinct values + counts for one field
  - tiled_search_items()    — filtered item list
"""

import logging
import re
from typing import Optional

logger = logging.getLogger("browse-server")

# Structural path segments that are never data nodes.
_STRUCTURAL_ROOTS = {"", "/", "beamlines"}


def _is_structural_path(path: str) -> bool:
    """Return True if *path* is a root or beamline-level container, not a data node."""
    p = path.strip("/")
    if p in _STRUCTURAL_ROOTS or not p:
        return True
    parts = p.split("/")
    last = parts[-1]
    if last == "beamlines" or re.match(r"^bl\d", last):
        return True
    if len(parts) >= 2 and parts[-2] == "beamlines" and re.match(r"^bl\d", parts[-1]):
        return True
    return False


# Mapping from thinfilm_ display keys to friendlier names.
DISPLAY_KEY_ALIASES: dict[str, str] = {"AnnealingTemp": "Temp"}

def build_field_mapping(container_node) -> dict:
    """Introspect the first item in *container_node* to discover available metadata keys.

    Returns a dict with three keys:
      - ``display_to_raw``:  display_key -> raw Tiled metadata key
      - ``raw_to_display``:  raw key -> display_key
      - ``all_display_keys``: display keys discovered from Tiled metadata (sorted alphabetically)
    """
    raw_keys: list[str] = []
    last_combined: list[str] = []

    try:
        for idx, first_key in enumerate(container_node):
            if idx >= 20:
                break

            first_item = container_node[first_key]
            item_meta = getattr(first_item, "metadata", {}) or {}
            combined_keys: list[str] = list(getattr(item_meta, "keys", lambda: [])())

            # Also pull array-level keys from the first child of the container
            try:
                first_child_key = next(iter(first_item))
                child_meta = first_item[first_child_key].metadata
                for k in child_meta:
                    if k not in combined_keys:
                        combined_keys.append(k)
            except (StopIteration, KeyError, TypeError):
                pass

            last_combined = combined_keys

            has_thinfilm = any(str(k).startswith("thinfilm_") for k in combined_keys)
            has_important = any(
                k in combined_keys
                for k in ("PI", "sample_name", "incident_angle_deg", "technique", "scan_type")
            )

            if has_thinfilm or (has_important and len(combined_keys) >= 4) or len(combined_keys) >= 10:
                raw_keys = combined_keys
                break

        if not raw_keys and last_combined:
            raw_keys = last_combined
    except (StopIteration, KeyError, TypeError):
        pass

    display_to_raw: dict[str, str] = {}
    raw_to_display: dict[str, str] = {}

    for raw_key in raw_keys:
        if raw_key.startswith("thinfilm_"):
            stripped = raw_key[len("thinfilm_"):]
            display_key = DISPLAY_KEY_ALIASES.get(stripped, stripped)
        else:
            display_key = raw_key

        if display_key not in display_to_raw:
            display_to_raw[display_key] = raw_key
        raw_to_display[raw_key] = display_key

    all_display_keys = sorted(display_to_raw.keys())

    return {
        "display_to_raw": display_to_raw,
        "raw_to_display": raw_to_display,
        "all_display_keys": all_display_keys,
    }


def tiled_distinct_values(
    container_node,
    raw_key: str,
    filters: Optional[dict] = None,
    field_mapping: Optional[dict] = None,
    limit: int = 500,
) -> dict:
    """Call ``container_node.distinct(raw_key)`` with optional upstream filters.

    Returns::

        {
          "values": [{"value": str, "count": int, "sample_paths": []}, ...],
          "total":  int,
          "field":  str,
        }
    """
    from tiled.queries import Key

    filters = filters or {}
    display_to_raw: dict = (field_mapping or {}).get("display_to_raw", {})

    node = container_node
    for disp_key, val in filters.items():
        if val is None:
            continue
        r_key = display_to_raw.get(disp_key, disp_key)
        try:
            node = node.search(Key(r_key) == val)
        except Exception:
            pass

    try:
        result = node.distinct(raw_key, counts=True)
        raw_values = result.get("metadata", {}).get(raw_key, [])
    except Exception as exc:
        logger.warning("distinct() failed for key %r: %s", raw_key, exc)
        raw_values = []

    non_null = [
        entry for entry in raw_values
        if entry.get("value") is not None
        and str(entry["value"]).strip() not in ("", "None", "NaN", "nan")
    ]

    sorted_vals = sorted(non_null, key=lambda e: (-e.get("count", 0), str(e["value"])))[:limit]

    display_key = (field_mapping or {}).get("raw_to_display", {}).get(raw_key, raw_key)

    return {
        "values": [
            {"value": str(e["value"]).strip(), "count": e.get("count", 1), "sample_paths": []}
            for e in sorted_vals
        ],
        "total": len(non_null),
        "field": display_key,
    }


def tiled_search_items(
    container_node,
    filters: Optional[dict] = None,
    field_mapping: Optional[dict] = None,
    limit: int = 500,
    container_path_prefix: str = "",
) -> dict:
    """Apply *filters* via ``search(Key())`` and return matching container entries.

    Returns::

        {
          "items": [{"path": str, "sample": str, "metadata": dict}, ...],
          "total": int,
        }
    """
    from tiled.queries import Key

    filters = filters or {}
    display_to_raw: dict = (field_mapping or {}).get("display_to_raw", {})

    ARRAY_ONLY_RAW_KEYS = {"angle_id", "incident_angle_deg", "bar"}

    raw_filters: list[tuple[str, str]] = []
    array_only_present = False
    for disp_key, val in filters.items():
        if val is None:
            continue
        r_key = display_to_raw.get(disp_key, disp_key)
        if r_key in ARRAY_ONLY_RAW_KEYS:
            array_only_present = True
        raw_filters.append((r_key, str(val)))

    def _typed_query_value(key: str, s: str):
        # Try int first (preserves exact match for integer-stored values)
        try:
            iv = int(s)
            if str(iv) == s:   # only if it round-trips exactly (e.g. "28" → 28)
                return iv
        except (ValueError, TypeError):
            pass
        # Try float for any decimal value
        try:
            return float(s)
        except (ValueError, TypeError):
            pass
        return s

    if not array_only_present:
        node = container_node
        for r_key, val in raw_filters:
            try:
                node = node.search(Key(r_key) == _typed_query_value(r_key, val))
            except Exception:
                pass

        items: list[dict] = []
        try:
            keys = list(node)[:limit]
            for k in keys:
                try:
                    entry = node[k]
                    meta = dict(entry.metadata) if hasattr(entry, "metadata") else {}
                    full_path = f"{container_path_prefix}/{k}" if container_path_prefix else k
                    items.append({"path": full_path, "sample": k, "metadata": meta})
                except Exception:
                    continue
        except Exception as exc:
            logger.warning("tiled_search_items iteration failed: %s", exc)

        return {"items": items, "total": len(items)}

    # Array-only filters present
    items = []
    array_only_filter_vals: dict[str, str] = {}
    for r_key, val in raw_filters:
        if r_key in ARRAY_ONLY_RAW_KEYS:
            array_only_filter_vals[r_key] = val

    has_container_level_filters = any(r_key not in ARRAY_ONLY_RAW_KEYS for r_key, _ in raw_filters)
    if not has_container_level_filters:
        node = container_node
        for r_key, val in raw_filters:
            try:
                node = node.search(Key(r_key) == _typed_query_value(r_key, val))
            except Exception:
                pass

        sample_keys: list[str] = []
        try:
            for k in list(node)[: max(limit * 200, 1000)]:
                sample_key = str(k).split("/", 1)[0]
                if sample_key and sample_key not in sample_keys:
                    sample_keys.append(sample_key)
                if len(sample_keys) >= limit:
                    break
        except Exception as exc:
            logger.warning("tiled_search_items fast-path iteration failed: %s", exc)

        for sample_key in sample_keys:
            try:
                sample_node = container_node[sample_key]
                sample_meta = dict(sample_node.metadata) if hasattr(sample_node, "metadata") else {}
            except Exception:
                continue
            for k, v in array_only_filter_vals.items():
                sample_meta[k] = v
            full_path = f"{container_path_prefix}/{sample_key}" if container_path_prefix else sample_key
            items.append({"path": full_path, "sample": sample_key, "metadata": sample_meta})

        return {"items": items, "total": len(items)}

    for sample_key in list(container_node)[: max(500, limit * 5)]:
        try:
            sample_node = container_node[sample_key]
        except Exception:
            continue

        sample_meta = dict(sample_node.metadata) if hasattr(sample_node, "metadata") else {}

        container_match = True
        for r_key, val in raw_filters:
            if r_key in ARRAY_ONLY_RAW_KEYS:
                continue
            sample_val = sample_meta.get(r_key)
            if sample_val is None:
                container_match = False
                break
            if str(sample_val).lower().strip() != val.lower().strip():
                container_match = False
                break
        if not container_match:
            continue

        node = sample_node
        for r_key, val in raw_filters:
            if r_key in ARRAY_ONLY_RAW_KEYS:
                try:
                    node = node.search(Key(r_key) == _typed_query_value(r_key, val))
                except Exception:
                    pass

        try:
            if not list(node)[:1]:
                continue
        except Exception:
            continue

        for k, v in array_only_filter_vals.items():
            sample_meta[k] = v

        full_path = f"{container_path_prefix}/{sample_key}" if container_path_prefix else sample_key
        items.append({"path": full_path, "sample": sample_key, "metadata": sample_meta})
        if len(items) >= limit:
            break

    return {"items": items, "total": len(items)}
