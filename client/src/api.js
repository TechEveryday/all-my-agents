import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(message, body) {
    super(message);
    this.body = body;
    this.code = body?.code;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `${res.status} ${res.statusText}`, data);
  return data;
}

/** Fetch `path` and refetch whenever `deps` change. */
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const load = useCallback(async (override) => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await api(override || path);
      if (n === seq.current) setState({ data, error: null, loading: false });
      return data;
    } catch (err) {
      if (n === seq.current) setState((s) => ({ data: s.data, error: err.message, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);
  return { ...state, reload: load, setData: (fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })) };
}

// ---- Server-sent events (one shared connection) ----------------------------
const listeners = new Map();
let source = null;

function ensureSource() {
  if (source) return;
  source = new EventSource('/api/events');
  for (const evt of ['stream', 'stream-removed', 'activity', 'todos-changed', 'notice']) {
    source.addEventListener(evt, (e) => {
      const data = JSON.parse(e.data);
      for (const fn of listeners.get(evt) || []) fn(data);
    });
  }
}

export function useEvent(event, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    ensureSource();
    const fn = (d) => ref.current(d);
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event).delete(fn);
  }, [event]);
}

// ---- formatting helpers -----------------------------------------------------
export function weekOf(date = new Date()) {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function clockTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
