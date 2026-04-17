import { useEffect, useState } from 'react';
import ColumnBrowser from '@/components/Browse/ColumnBrowser';
import { API_BASE } from '@/config';
import type { ServerInfo } from '@/types/server';

const DEFAULT_SERVERS: ServerInfo[] = [
  { name: 'Local Data (port 8010)', uri: 'http://127.0.0.1:8010', has_api_key: false },
];

export default function BrowsePage() {
  const [servers, setServers] = useState<ServerInfo[]>(DEFAULT_SERVERS);
  const [selectedServer, setSelectedServer] = useState<string>(DEFAULT_SERVERS[0].name);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    fetch(`${API_BASE}/api/config/servers`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ServerInfo[]) => {
        if (cancelled) return;
        const list = data?.length ? data : DEFAULT_SERVERS;
        setServers(list);
        setSelectedServer((current) => (list.some((s) => s.name === current) ? current : list[0].name));
      })
      .catch(() => {
        if (!cancelled) setServers(DEFAULT_SERVERS);
      });

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  const server = servers.find((s) => s.name === selectedServer);
  const serverUri = server?.uri ?? '';
  const serverApiKey = server?.api_key ?? '';

  return (
    <div className="flex flex-col h-full bg-slate-900">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-800 shrink-0">
        <label htmlFor="browse-server" className="text-xs font-medium text-slate-500 whitespace-nowrap">
          Server
        </label>
        <select
          id="browse-server"
          value={selectedServer}
          onChange={(e) => setSelectedServer(e.target.value)}
          className="text-xs rounded px-2 py-1 bg-slate-800 text-slate-200 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500 min-w-[200px]"
        >
          {servers.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 min-h-0">
        <ColumnBrowser key={serverUri} serverUri={serverUri} serverApiKey={serverApiKey} technique="All" />
      </div>
    </div>
  );
}
