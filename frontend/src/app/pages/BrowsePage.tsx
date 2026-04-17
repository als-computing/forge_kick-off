import { useState, useEffect } from 'react';
import ColumnBrowser from '@/components/Browse/ColumnBrowser';
import { API_BASE } from '@/config';
import type { ServerInfo } from '@/components/Graph/types';

const DEFAULT_SERVERS: ServerInfo[] = [
  { name: 'Local Data (port 8010)', uri: 'http://127.0.0.1:8010', has_api_key: false },
];

export default function BrowsePage() {
  const [servers, setServers] = useState<ServerInfo[]>(DEFAULT_SERVERS);
  const [selectedServer, setSelectedServer] = useState('');
  // splash_links smart filters
  const [showFlagged, setShowFlagged] = useState(false);
  const [showPublished, setShowPublished] = useState(false);
  const [flaggedPaths, setFlaggedPaths] = useState<Set<string>>(new Set());
  const [publishedPaths, setPublishedPaths] = useState<Set<string>>(new Set());
  const [splashAvailable, setSplashAvailable] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/links/health`)
      .then(r => r.json())
      .then(d => setSplashAvailable(d.status === 'ok'))
      .catch(() => setSplashAvailable(false));
  }, []);

  useEffect(() => {
    if (!splashAvailable) return;
    // Load flagged paths
    fetch(`${API_BASE}/api/links/links?predicate=flagged_as&limit=500`)
      .then(r => r.ok ? r.json() : { links: [] })
      .then(d => {
        const paths = new Set<string>((d.links ?? []).map((l: { subject?: { name?: string } }) => l.subject?.name).filter(Boolean) as string[]);
        setFlaggedPaths(paths);
      })
      .catch(() => {});
    // Load published paths
    fetch(`${API_BASE}/api/links/links?predicate=published_in&limit=500`)
      .then(r => r.ok ? r.json() : { links: [] })
      .then(d => {
        const paths = new Set<string>((d.links ?? []).map((l: { subject?: { name?: string } }) => l.subject?.name).filter(Boolean) as string[]);
        setPublishedPaths(paths);
      })
      .catch(() => {});
  }, [splashAvailable]);

  useEffect(() => {
    fetch(`${API_BASE}/api/config/servers`)
      .then(r => r.json())
      .then(data => {
        const list: ServerInfo[] = data.length ? data : DEFAULT_SERVERS;
        setServers(list);
        if (!selectedServer) {
          setSelectedServer(list[0].name);
        }
      })
      .catch(() => setServers(DEFAULT_SERVERS));
  }, []);

  const server = servers.find(s => s.name === selectedServer);
  const serverUri = server?.uri || '';
  const serverApiKey = (server as any)?.api_key || '';

  // Build active path filter from splash_links toggles
  const splashPathFilter = (showFlagged || showPublished) ? (path: string) => {
    if (showFlagged && !flaggedPaths.has(path)) return false;
    if (showPublished && !publishedPaths.has(path)) return false;
    return true;
  } : null;

  return (
    <div className="flex flex-col h-full" style={{ background: '#0f172a' }}>
      {/* Page toolbar */}
      <div
        className="flex items-center gap-3 px-4 py-2 border-b shrink-0 flex-wrap"
        style={{ borderColor: '#1e293b', background: '#0f172a' }}
      >
        {/* Server selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium" style={{ color: '#64748b', whiteSpace: 'nowrap' }}>
            Server
          </label>
          <select
            value={selectedServer}
            onChange={e => setSelectedServer(e.target.value)}
            className="text-xs rounded px-2 py-1 focus:outline-none focus:ring-1"
            style={{
              background: '#1e293b',
              color: '#e2e8f0',
              border: '1px solid #334155',
              minWidth: 200,
            }}
          >
            {servers.map(s => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* splash_links smart filters (only shown when splash_links is available) */}
        {splashAvailable && (
          <div className="flex items-center gap-2 border-l border-slate-700 pl-3">
            <span className="text-[10px] text-slate-500 font-mono">Links:</span>
            <button
              onClick={() => setShowFlagged(f => !f)}
              className="px-2 py-0.5 text-[10px] font-mono rounded border transition-all"
              style={{
                borderColor: showFlagged ? '#eab308' : '#334155',
                background: showFlagged ? 'rgba(234,179,8,0.1)' : '#1e293b',
                color: showFlagged ? '#fbbf24' : '#64748b',
              }}
              title={`${flaggedPaths.size} flagged samples`}
            >
              ⚑ Flagged ({flaggedPaths.size})
            </button>
            <button
              onClick={() => setShowPublished(p => !p)}
              className="px-2 py-0.5 text-[10px] font-mono rounded border transition-all"
              style={{
                borderColor: showPublished ? '#f59e0b' : '#334155',
                background: showPublished ? 'rgba(245,158,11,0.1)' : '#1e293b',
                color: showPublished ? '#fcd34d' : '#64748b',
              }}
              title={`${publishedPaths.size} published samples`}
            >
              ★ Published ({publishedPaths.size})
            </button>
          </div>
        )}
      </div>

      {/* Browser takes remaining space */}
      <div className="flex-1 min-h-0">
        <ColumnBrowser
          key={serverUri}
          serverUri={serverUri}
          serverApiKey={serverApiKey}
          technique="All"
          splashPathFilter={splashPathFilter}
        />
      </div>
    </div>
  );
}
