import { useEffect, useState } from 'react';
import { api, useApi, useEvent, weekOf } from './api.js';
import { GithubIcon, RefreshIcon, XIcon, CopyIcon } from './components/Icons.jsx';
import { Tabs } from './components/ui.jsx';
import MyWork from './pages/MyWork.jsx';
import Workflow from './pages/Workflow.jsx';
import PullRequests from './pages/PullRequests.jsx';
import Settings from './pages/Settings.jsx';
import AgentDrawer from './pages/AgentDrawer.jsx';

const PAGES = [
  { id: 'work', label: 'My Work' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'prs', label: 'Pull Requests' },
  { id: 'settings', label: 'Settings' },
];

// ---- toasts -----------------------------------------------------------------
export function toast(text, tone = 'info') {
  window.dispatchEvent(new CustomEvent('ama-toast', { detail: { text, tone, id: Math.random() } }));
}

function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const on = (e) => {
      setItems((xs) => [...xs, e.detail]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== e.detail.id)), e.detail.tone === 'error' ? 8000 : 4000);
    };
    window.addEventListener('ama-toast', on);
    return () => window.removeEventListener('ama-toast', on);
  }, []);
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>
      ))}
    </div>
  );
}

function Header({ onRefresh, refreshing }) {
  const meta = useApi('/meta');
  const commit = meta.data?.commit;
  const gh = meta.data?.github;

  const stopAll = async () => {
    if (!window.confirm('Stop every running agent and script?')) return;
    try {
      const r = await api('/agents/stop-all', { method: 'POST' });
      toast(r.killed ? `Stopped ${r.killed} running process${r.killed === 1 ? '' : 'es'}` : 'No agents were running');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <header className="card header">
      <div className="header-left">
        <a className="gh-link" href={gh?.url || 'https://github.com'} target="_blank" rel="noreferrer" title={gh?.login ? `@${gh.login} on GitHub` : 'GitHub'}>
          <GithubIcon width={26} height={26} />
        </a>
        {commit?.short && (
          <button
            className="sha"
            title={`Running commit ${commit.sha}${commit.dirty ? ' (with uncommitted changes)' : ''} — click to copy`}
            onClick={() => {
              navigator.clipboard?.writeText(commit.sha);
              toast('Commit SHA copied');
            }}
          >
            <CopyIcon /> {commit.short}
            {commit.dirty && <span className="dirty">•</span>}
          </button>
        )}
        <div className="title-block">
          <h1>All My Agents</h1>
          <div className="week">Week of {weekOf()}</div>
        </div>
      </div>
      <div className="header-actions">
        <button className="icon-btn danger" onClick={stopAll} title="Stop all agent runners" aria-label="Stop all agent runners">
          <XIcon />
        </button>
        <button className={`icon-btn ${refreshing ? 'spinning' : ''}`} onClick={onRefresh} title="Refresh and refetch everything" aria-label="Refresh">
          <RefreshIcon />
        </button>
      </div>
    </header>
  );
}

export default function App() {
  const [page, setPage] = useState(() => {
    try { return localStorage.getItem('ama-page') || 'work'; } catch { return 'work'; }
  });
  const [tick, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const settings = useApi('/settings', [tick]);
  const streams = useApi('/streams', [tick]);
  const models = useApi('/models', [tick]);
  // The Agent Activity rail lives here so it stays open while you switch tabs.
  const [railId, setRailId] = useState(() => {
    try { return localStorage.getItem('ama-rail') || null; } catch { return null; }
  });
  useEffect(() => {
    try { railId ? localStorage.setItem('ama-rail', railId) : localStorage.removeItem('ama-rail'); } catch { /* storage unavailable */ }
  }, [railId]);

  useEvent('stream', (s) =>
    streams.setData((d) => {
      if (!d) return d;
      const exists = d.streams.some((x) => x.id === s.id);
      return { streams: exists ? d.streams.map((x) => (x.id === s.id ? { ...x, ...s } : x)) : [s, ...d.streams] };
    }),
  );
  useEvent('stream-removed', ({ id }) => {
    streams.setData((d) => d && { streams: d.streams.filter((x) => x.id !== id) });
    setRailId((cur) => (cur === id ? null : cur));
  });
  const railStream = streams.data?.streams.find((s) => s.id === railId);

  useEffect(() => {
    try { localStorage.setItem('ama-page', page); } catch { /* storage unavailable */ }
  }, [page]);

  useEvent('notice', (n) => {
    toast(`${n.title}: ${n.text}`, 'error');
    if (settings.data?.notifyAttention && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(n.title, { body: n.text });
    }
  });

  const refresh = async () => {
    setRefreshing(true);
    await api('/todos?force=1').catch(() => {});
    setTick((t) => t + 1);
    setTimeout(() => setRefreshing(false), 600);
  };

  return (
    <div className={`layout ${railStream ? 'with-rail' : ''}`}>
    <div className="app">
      <Header onRefresh={refresh} refreshing={refreshing} />
      <nav className="page-tabs">
        <Tabs tabs={PAGES} value={page} onChange={setPage} />
      </nav>
      <main>
        {page === 'work' && <MyWork tick={tick} streams={streams} railId={railStream ? railId : null} onOpenRail={setRailId} />}
        {page === 'workflow' && <Workflow tick={tick} />}
        {page === 'prs' && <PullRequests tick={tick} />}
        {page === 'settings' && <Settings tick={tick} onSaved={() => setTick((t) => t + 1)} />}
      </main>
      <Toasts />
    </div>
    {railStream && <AgentDrawer stream={railStream} models={models.data?.models || []} onClose={() => setRailId(null)} />}
    </div>
  );
}
