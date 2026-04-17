import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '@/config';

const BROWSE_TIMEOUT_MS = 60_000;

function fetchWithTimeout(url: string, timeoutMs = BROWSE_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(id));
}

export interface BrowseValue {
  value: string;
  count: number;
  sample_paths: string[];
}

export interface BrowseItem {
  path: string;
  sample: string;
  metadata: Record<string, unknown>;
}

export interface ColumnState {
  field: string;
  values: BrowseValue[];
  loading: boolean;
  error: string | null;
  selected: string | null;
}

export interface BrowseState {
  columns: ColumnState[];
  items: BrowseItem[];
  itemsTotal: number;
  itemsLoading: boolean;
  facets: string[];
  facetsLoading: boolean;
  selectedItem: BrowseItem | null;
  connectionStatus: 'loading' | 'connected' | 'disconnected';
}

function buildFilters(columns: ColumnState[], upToIndex: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < upToIndex; i++) {
    const col = columns[i];
    if (col.selected !== null) out[col.field] = col.selected;
  }
  return out;
}

export function useBrowseData(serverUri: string, technique: string, serverApiKey?: string) {
  const [state, setState] = useState<BrowseState>({
    columns: [],
    items: [],
    itemsTotal: 0,
    itemsLoading: false,
    facets: [],
    facetsLoading: true,
    selectedItem: null,
    connectionStatus: 'loading',
  });

  // Ref to track latest state without causing re-fetch loops
  const stateRef = useRef(state);
  stateRef.current = state;

  // ------------------------------------------------------------------
  // Fetch available facets
  // ------------------------------------------------------------------
  const loadFacets = useCallback(async () => {
    setState(s => ({ ...s, facetsLoading: true }));
    const params = new URLSearchParams({ technique });
    if (serverUri) params.set('server_uri', serverUri);
    if (serverApiKey) params.set('server_api_key', serverApiKey);
    // 'All' can hit stale empty facet caches; force a refresh so the UI can
    // add columns immediately.
    if (technique === 'All') params.set('refresh', 'true');
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/browse/facets?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setState(s => ({
        ...s,
        facets: data.facets || [],
        facetsLoading: false,
        connectionStatus: 'connected',
      }));
    } catch (e) {
      console.warn('Browse facets unavailable:', e);
      setState(s => ({
        ...s,
        facetsLoading: false,
        connectionStatus: 'disconnected',
      }));
    }
  }, [serverUri, serverApiKey, technique]);

  // ------------------------------------------------------------------
  // Fetch values for a single column
  // ------------------------------------------------------------------
  const loadColumn = useCallback(async (colIndex: number, field: string, filters: Record<string, string>) => {
    setState(s => {
      const cols = [...s.columns];
      if (cols[colIndex]) cols[colIndex] = { ...cols[colIndex], loading: true, error: null };
      return { ...s, columns: cols };
    });

    const params = new URLSearchParams({ technique, field, filters: JSON.stringify(filters) });
    if (serverUri) params.set('server_uri', serverUri);
    if (serverApiKey) params.set('server_api_key', serverApiKey);

    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/browse/column?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setState(s => {
        const cols = [...s.columns];
        if (cols[colIndex]) {
          cols[colIndex] = { ...cols[colIndex], values: data.values || [], loading: false };
        }
        return { ...s, columns: cols };
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState(s => {
        const cols = [...s.columns];
        if (cols[colIndex]) cols[colIndex] = { ...cols[colIndex], loading: false, error: msg };
        return { ...s, columns: cols };
      });
    }
  }, [serverUri, serverApiKey, technique]);

  // ------------------------------------------------------------------
  // Fetch leaf items
  // ------------------------------------------------------------------
  const loadItems = useCallback(async (filters: Record<string, string>) => {
    setState(s => ({ ...s, itemsLoading: true }));
    const params = new URLSearchParams({ technique, filters: JSON.stringify(filters) });
    if (serverUri) params.set('server_uri', serverUri);
    if (serverApiKey) params.set('server_api_key', serverApiKey);
    // These facets live at the array-node level in Tiled. Our browse-items
    // implementation needs to map back to parent sample containers, which
    // can be subject to stale cached empty results. Force a backend refresh
    // when we filter by array-level keys (or when Technique=All).
    const shouldRefresh =
      technique === 'All' ||
      Object.prototype.hasOwnProperty.call(filters, 'angle_id') ||
      Object.prototype.hasOwnProperty.call(filters, 'incident_angle_deg');
    if (shouldRefresh) params.set('refresh', 'true');

    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/browse/items?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setState(s => ({
        ...s,
        items: data.items || [],
        itemsTotal: data.total || 0,
        itemsLoading: false,
      }));
    } catch (e) {
      setState(s => ({ ...s, itemsLoading: false, items: [], itemsTotal: 0 }));
    }
  }, [serverUri, serverApiKey, technique]);
  // ------------------------------------------------------------------
  // Public actions
  // ------------------------------------------------------------------

  const addColumn = useCallback((field: string) => {
    setState(s => {
      const newCol: ColumnState = { field, values: [], loading: true, error: null, selected: null };
      const newCols = [...s.columns, newCol];
      const newColIndex = newCols.length - 1;
      const filters = buildFilters(newCols, newColIndex);
      // Trigger load after state update
      setTimeout(() => loadColumn(newColIndex, field, filters), 0);
      return { ...s, columns: newCols };
    });
  }, [loadColumn]);

  const removeColumn = useCallback((colIndex: number) => {
    setState(s => {
      const newCols = s.columns.slice(0, colIndex);
      return { ...s, columns: newCols, items: [], itemsTotal: 0, selectedItem: null };
    });
  }, []);

  const changeColumnField = useCallback((colIndex: number, field: string) => {
    setState(s => {
      const cols = s.columns.slice(0, colIndex);
      const newCol: ColumnState = { field, values: [], loading: true, error: null, selected: null };
      const newCols = [...cols, newCol];
      const filters = buildFilters(newCols, colIndex);
      setTimeout(() => loadColumn(colIndex, field, filters), 0);
      return { ...s, columns: newCols, items: [], itemsTotal: 0, selectedItem: null };
    });
  }, [loadColumn]);

  const selectValue = useCallback((colIndex: number, value: string | null) => {
    setState(s => {
      // Update selection in this column, clear downstream columns
      const cols = s.columns.slice(0, colIndex + 1).map((c, i) =>
        i === colIndex ? { ...c, selected: value } : c
      );

      if (value === null) {
        return { ...s, columns: cols, items: [], itemsTotal: 0, selectedItem: null };
      }

      const filtersForNext = buildFilters([...cols], colIndex + 1);

      // If there's a next column, reload it
      if (colIndex + 1 < s.columns.length) {
        const nextCol = s.columns[colIndex + 1];
        const nextCols = [
          ...cols,
          { ...nextCol, values: [], loading: true, error: null, selected: null },
          // Reset all further columns too
          ...s.columns.slice(colIndex + 2).map(c => ({
            ...c,
            values: [],
            loading: false,
            error: null,
            selected: null,
          })),
        ];
        setTimeout(() => loadColumn(colIndex + 1, nextCol.field, filtersForNext), 0);
        return { ...s, columns: nextCols, items: [], itemsTotal: 0, selectedItem: null };
      }

      // No next column -- load leaf items
      const allFilters = buildFilters([...cols], cols.length);
      setTimeout(() => {
        const f = { ...allFilters, [cols[colIndex].field]: value };
        loadItems(f);
      }, 0);

      return { ...s, columns: cols, selectedItem: null };
    });
  }, [loadColumn, loadItems]);

  const selectItem = useCallback((item: BrowseItem | null) => {
    setState(s => ({ ...s, selectedItem: item }));
  }, []);

  const refresh = useCallback(() => {
    const s = stateRef.current;
    if (s.columns.length === 0) return;
    s.columns.forEach((col, i) => {
      const filters = buildFilters(s.columns, i);
      loadColumn(i, col.field, filters);
    });
    const allFilters = buildFilters(s.columns, s.columns.length);
    loadItems(allFilters);
  }, [loadColumn, loadItems]);

  // Init: load facets on mount / server change, then poll every 30s
  useEffect(() => {
    loadFacets();
    setState(s => ({ ...s, columns: [], items: [], itemsTotal: 0, selectedItem: null }));
    const interval = setInterval(loadFacets, 30_000);
    return () => clearInterval(interval);
  }, [loadFacets]);

  return {
    state,
    actions: { addColumn, removeColumn, changeColumnField, selectValue, selectItem, refresh, loadFacets },
  };
}
