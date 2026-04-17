import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Plus, ArrowsClockwise, File, CheckSquare, Square, CloudArrowUp } from '@phosphor-icons/react';
import BrowseColumn from './BrowseColumn';
import BrowseDetailPanel from './BrowseDetailPanel';
import ResizeDivider from './ResizeDivider';
import type { BrowseItem } from './hooks/useBrowseData';
import { useBrowseData } from './hooks/useBrowseData';
import { useGIWAXSStore } from '@/stores/giwaxsStore';

interface ColumnBrowserProps {
  serverUri: string;
  technique: string;
  serverApiKey?: string;
  /** Optional client-side filter: given a Tiled path, return true to include it */
  splashPathFilter?: ((path: string) => boolean) | null;
}

const DEFAULT_COLUMN_WIDTH = 220;
const DEFAULT_ITEMS_WIDTH = 260;

export default function ColumnBrowser({ serverUri, technique, serverApiKey, splashPathFilter }: ColumnBrowserProps) {
  const { state, actions } = useBrowseData(serverUri, technique, serverApiKey);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Resizable column widths: one per metadata column, plus one for the Samples column
  const [columnWidths, setColumnWidths] = useState<number[]>([]);
  const [itemsColumnWidth, setItemsColumnWidth] = useState(DEFAULT_ITEMS_WIDTH);

  // Multi-select: set of item paths currently checked
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  // Brief confirmation message after staging
  const [stagedMsg, setStagedMsg] = useState<string | null>(null);

  const setStagedItems = useGIWAXSStore(s => s.setStagedDataItems);
  const stagedItems   = useGIWAXSStore(s => s.stagedDataItems);
  const setMetadataDisplayKeys = useGIWAXSStore(s => s.setMetadataDisplayKeys);

  // Keep columnWidths in sync with number of columns
  // Give the first column extra width when it's sample_name (IDs are ~8 chars)
  useEffect(() => {
    const n = state.columns.length;
    setColumnWidths(prev => {
      if (prev.length === n) return prev;
      if (prev.length < n) {
        const additions = Array.from({ length: n - prev.length }, (_, i) => {
          const colIndex = prev.length + i;
          const field = state.columns[colIndex]?.field;
          return field === 'sample_name' ? 190 : DEFAULT_COLUMN_WIDTH;
        });
        return [...prev, ...additions];
      }
      return prev.slice(0, n);
    });
  }, [state.columns.length, state.columns]);

  // Clear selection when the items list changes
  useEffect(() => {
    setSelectedPaths(new Set());
  }, [state.items]);

  const handleResizeColumn = useCallback((index: number, newWidth: number) => {
    setColumnWidths(prev => {
      const next = [...prev];
      if (index >= 0 && index < next.length) next[index] = newWidth;
      return next;
    });
  }, []);

  const handleResizeItemsColumn = useCallback((newWidth: number) => {
    setItemsColumnWidth(newWidth);
  }, []);

  // When columns are added, scroll the container to the right
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [state.columns.length]);

  // Auto-populate with default columns on first load
  const initialised = useRef(false);
  useEffect(() => {
    if (!initialised.current && state.facets.length > 0) {
      initialised.current = true;
      const n = Math.min(5, state.facets.length);
      state.facets.slice(0, n).forEach(f => actions.addColumn(f));
    }
  }, [state.facets, actions]);

  // Publish selected column keys to the store whenever columns change
  useEffect(() => {
    const keys = state.columns.map(col => col.field);
    setMetadataDisplayKeys(keys);
  }, [state.columns, setMetadataDisplayKeys]);

  const handleAddColumn = () => {
    const usedFields = new Set(state.columns.map(c => c.field));
    const next = state.facets.find(f => !usedFields.has(f));
    if (next) actions.addColumn(next);
  };

  // Selection helpers
  const togglePath = useCallback((path: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedPaths(new Set(state.items.map(i => i.path)));
  }, [state.items]);

  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set());
  }, []);

  // Stage the selected items into giwaxsStore
  const stageSelected = useCallback(() => {
    const toAdd = state.items
      .filter(item => selectedPaths.has(item.path))
      .filter(item => !stagedItems.some(s => s.tiledId === item.path))
      .map(item => ({
        id: `browse-${item.path}-${Date.now()}`,
        name: String(item.metadata['sample_name'] || item.sample),
        source: 'tiled' as const,
        tiledId: item.path,
        tiledUri: serverUri || undefined,
        tiledApiKey: serverApiKey || undefined,
        metadata: {
          sample_name: String(item.metadata['sample_name'] || item.sample),
          bar: typeof item.metadata['bar'] === 'number' ? item.metadata['bar'] as number : undefined,
          sample_folder: item.metadata['sample_folder'] as string | undefined,
          beamline: item.metadata['beamline'] as string | undefined,
        },
      }));

    if (toAdd.length === 0) return;

    setStagedItems([...stagedItems, ...toAdd]);
    const msg = toAdd.length === 1
      ? `"${toAdd[0].name}" added to GIWAXS staging`
      : `${toAdd.length} scans added to GIWAXS staging`;
    setStagedMsg(msg);
    setSelectedPaths(new Set());
    setTimeout(() => setStagedMsg(null), 3500);
  }, [state.items, selectedPaths, stagedItems, setStagedItems, serverUri, serverApiKey]);

  const allFilters: Record<string, string> = {};
  state.columns.forEach(col => {
    if (col.selected !== null) allFilters[col.field] = col.selected;
  });
  const hasAnySelection = Object.keys(allFilters).length > 0;
  // Show the Samples column as soon as the last column has a value selected
  // (the user doesn't need to select a value in every column)
  const lastCol = state.columns[state.columns.length - 1];
  const showItems = state.columns.length > 0 && lastCol?.selected !== null;

  return (
    <div className="flex flex-col h-full" style={{ background: '#0f172a', color: '#e2e8f0' }}>
      {/* Toolbar */}
      <div
        className="flex items-center gap-3 px-4 py-2 border-b shrink-0"
        style={{ borderColor: '#334155', background: '#1e293b' }}
      >
        <span className="text-sm font-semibold" style={{ color: '#94a3b8' }}>
          Metadata Browser
        </span>

        {state.facetsLoading && (
          <span className="text-xs" style={{ color: '#64748b' }}>Loading fields…</span>
        )}

        <div className="flex items-center gap-1 ml-auto">
          {hasAnySelection && (
            <span className="text-xs px-2 py-0.5 rounded" style={{ background: '#1e3a5f', color: '#93c5fd' }}>
              {Object.keys(allFilters).length} filter{Object.keys(allFilters).length !== 1 ? 's' : ''} active
            </span>
          )}

          {/* Stage button – only visible when items are checked */}
          {selectedPaths.size > 0 && (
            <button
              onClick={stageSelected}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors"
              style={{ background: '#166534', color: '#86efac', border: '1px solid #15803d' }}
              title="Add selected scans to GIWAXS staging area"
            >
              <CloudArrowUp size={13} />
              Stage {selectedPaths.size}
            </button>
          )}

          <button
            onClick={actions.refresh}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-slate-700 transition-colors"
            style={{ color: '#64748b' }}
            title="Refresh"
          >
            <ArrowsClockwise size={13} />
          </button>
          <button
            onClick={handleAddColumn}
            disabled={state.facetsLoading || state.facets.length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors disabled:opacity-40"
            style={{ background: '#1d4ed8', color: '#fff' }}
          >
            <Plus size={12} />
            Add column
          </button>
        </div>
      </div>

      {/* Confirmation banner */}
      {stagedMsg && (
        <div
          className="shrink-0 px-4 py-1.5 text-xs font-medium border-b flex items-center gap-2"
          style={{ background: '#14532d', color: '#86efac', borderColor: '#166534' }}
        >
          <CheckSquare size={13} weight="fill" />
          {stagedMsg} — switch to the <strong className="mx-0.5">GIWAXS</strong> tab → Select Data to view.
        </div>
      )}

      {/* Connection error banner */}
      {state.connectionStatus === 'disconnected' && (
        <div
          className="shrink-0 px-4 py-2 text-xs border-b"
          style={{ background: '#450a0a', color: '#fca5a5', borderColor: '#7f1d1d' }}
        >
          Cannot reach the API server. Make sure the backend (port 8002) and Tiled server are running.
        </div>
      )}

      {/* Main browser area */}
      <div className="flex flex-1 min-h-0">
        {/* Columns scroll container */}
        <div
          ref={scrollRef}
          className="flex flex-1 overflow-x-auto overflow-y-hidden"
          style={{ minWidth: 0 }}
        >
          {state.columns.length === 0 && !state.facetsLoading && (
            <div className="flex items-center justify-center flex-1">
              <p className="text-sm" style={{ color: '#64748b' }}>
                {state.connectionStatus === 'disconnected'
                  ? 'Connect to a Tiled server to browse.'
                  : 'Click "Add column" to start browsing.'}
              </p>
            </div>
          )}

          {state.columns.map((col, i) => (
            <React.Fragment key={i}>
              <BrowseColumn
                colIndex={i}
                column={col}
                facets={state.facets}
                width={columnWidths[i] ?? DEFAULT_COLUMN_WIDTH}
                onFieldChange={actions.changeColumnField}
                onSelect={actions.selectValue}
                onRemove={actions.removeColumn}
                isLast={i === state.columns.length - 1}
              />
              <ResizeDivider
                currentWidth={columnWidths[i] ?? DEFAULT_COLUMN_WIDTH}
                onResize={w => handleResizeColumn(i, w)}
              />
            </React.Fragment>
          ))}

          {/* Items column */}
          {showItems && (
            <>
              <ResizeDivider
                key="resize-items"
                currentWidth={itemsColumnWidth}
                onResize={handleResizeItemsColumn}
                resizeRight
              />
              <ItemsColumn
                items={splashPathFilter ? state.items.filter(i => splashPathFilter(i.path)) : state.items}
                total={splashPathFilter ? state.items.filter(i => splashPathFilter(i.path)).length : state.itemsTotal}
                loading={state.itemsLoading}
                selectedItem={state.selectedItem}
                onSelect={actions.selectItem}
                width={itemsColumnWidth}
                checkedPaths={selectedPaths}
                onToggleCheck={togglePath}
                onSelectAll={selectAll}
                onClearAll={clearSelection}
              />
            </>
          )}
        </div>

        {/* Detail panel */}
        <div
          className="flex flex-col h-full border-l shrink-0"
          style={{
            width: state.selectedItem ? 360 : 280,
            minWidth: 200,
            background: '#0f172a',
            borderColor: '#334155',
          }}
        >
          {state.selectedItem ? (
            <BrowseDetailPanel
              item={state.selectedItem}
              onClose={() => actions.selectItem(null)}
              serverUri={serverUri}
              serverApiKey={serverApiKey}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
              <p className="text-sm font-medium" style={{ color: '#94a3b8' }}>
                Metadata
              </p>
              <p className="text-xs mt-2" style={{ color: '#64748b' }}>
                Select a sample in the list to view its metadata here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Items column (leaf results)
// ------------------------------------------------------------------

interface ItemsColumnProps {
  items: BrowseItem[];
  total: number;
  loading: boolean;
  selectedItem: BrowseItem | null;
  onSelect: (item: BrowseItem | null) => void;
  width: number;
  checkedPaths: Set<string>;
  onToggleCheck: (path: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

function ItemsColumn({
  items, total, loading, selectedItem, onSelect, width,
  checkedPaths, onToggleCheck, onSelectAll, onClearAll,
}: ItemsColumnProps) {
  const allChecked = items.length > 0 && items.every(i => checkedPaths.has(i.path));
  const someChecked = checkedPaths.size > 0 && !allChecked;

  return (
    <div
      className="flex flex-col border-r"
      style={{
        minWidth: 120,
        width,
        maxWidth: 600,
        background: '#1e293b',
        borderColor: '#334155',
        flexShrink: 0,
      }}
    >
      {/* Column header */}
      <div
        className="px-3 py-2 border-b flex items-center gap-2"
        style={{ borderColor: '#334155', background: '#0f172a' }}
      >
        {/* Select-all checkbox */}
        <button
          onClick={allChecked ? onClearAll : onSelectAll}
          className="shrink-0 p-0.5 rounded hover:bg-slate-700 transition-colors"
          title={allChecked ? 'Deselect all' : 'Select all'}
          style={{ color: someChecked || allChecked ? '#3b82f6' : '#475569' }}
        >
          {allChecked ? (
            <CheckSquare size={14} weight="fill" />
          ) : someChecked ? (
            <CheckSquare size={14} />
          ) : (
            <Square size={14} />
          )}
        </button>

        <File size={13} style={{ color: '#3b82f6' }} />
        <span className="text-xs font-semibold" style={{ color: '#94a3b8' }}>
          Samples
        </span>
        {!loading && (
          <span
            className="ml-auto text-xs px-1.5 py-0.5 rounded-full font-mono"
            style={{ background: '#1e293b', color: '#64748b', fontSize: 10 }}
          >
            {checkedPaths.size > 0 ? `${checkedPaths.size}/${total}` : total}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
        {loading && (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs" style={{ color: '#64748b' }}>Loading…</span>
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="px-3 py-3">
            <p className="text-xs" style={{ color: '#64748b' }}>No matching samples</p>
          </div>
        )}
        {!loading && items.map((item: BrowseItem) => {
          const isSelected = selectedItem?.path === item.path;
          const isChecked = checkedPaths.has(item.path);
          return (
            <div
              key={item.path}
              className="flex items-start transition-colors"
              style={{
                background: isSelected ? '#1d4ed8' : isChecked ? '#1e3a5f' : 'transparent',
                borderBottom: '1px solid #1e293b',
              }}
              onMouseEnter={e => {
                if (!isSelected && !isChecked)
                  (e.currentTarget as HTMLDivElement).style.background = '#334155';
              }}
              onMouseLeave={e => {
                if (!isSelected)
                  (e.currentTarget as HTMLDivElement).style.background =
                    isChecked ? '#1e3a5f' : 'transparent';
              }}
            >
              {/* Checkbox */}
              <button
                onClick={() => onToggleCheck(item.path)}
                className="shrink-0 pl-2 pr-1 py-2 self-center"
                title={isChecked ? 'Deselect' : 'Select for staging'}
                style={{ color: isChecked ? '#3b82f6' : isSelected ? 'rgba(255,255,255,0.5)' : '#475569' }}
              >
                {isChecked
                  ? <CheckSquare size={13} weight="fill" />
                  : <Square size={13} />}
              </button>

              {/* Name / click to open detail */}
              <button
                onClick={() => onSelect(isSelected ? null : item)}
                className="flex-1 flex flex-col px-2 py-1.5 text-left min-w-0"
              >
                <span
                  className="text-xs font-medium truncate"
                  style={{ color: isSelected ? '#fff' : '#e2e8f0' }}
                >
                  {item.sample}
                </span>
                {item.metadata['angle_id'] != null && (
                  <span
                    className="text-xs truncate"
                    style={{ color: isSelected ? 'rgba(255,255,255,0.7)' : '#64748b' }}
                  >
                    {String(item.metadata['angle_id'])}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
