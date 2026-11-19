import { useEffect, useRef, useState } from 'react';
import { api, clockTime, useEvent } from '../api.js';
import { toast } from '../App.jsx';
import { ModelSelect, Spinner, StatusBadge } from '../components/ui.jsx';
import { BranchIcon, CodeIcon, ExternalIcon, SendIcon, StopIcon, XIcon } from '../components/Icons.jsx';
import { CopyButton, WorktreeTools, formatCost } from '../components/PathTools.jsx';

export default function AgentDrawer({ stream, models, onClose }) {
  const [activity, setActivity] = useState(null);
  const [text, setText] = useState('');
  const [model, setModel] = useState(stream.model || models[0]?.value || 'claude:opus');
  const [sending, setSending] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const feedRef = useRef(null);
  const stick = useRef(true);
  const busy = stream.status === 'Running' || stream.status === 'Queued';

  useEffect(() => {
    let cancelled = false;
    setActivity(null);
    api(`/streams/${stream.id}/activity`).then((d) => !cancelled && setActivity(d.activity)).catch((err) => toast(err.message, 'error'));
    setModel(stream.model || models[0]?.value || 'claude:opus');
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.id]);

  useEvent('activity', ({ streamId, entry }) => {
    if (streamId === stream.id) setActivity((a) => (a ? [...a, entry] : a));
  });

  useEffect(() => {
    const el = feedRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [activity]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await api(`/streams/${stream.id}/prompt`, { method: 'POST', body: { text, model } });
      setText('');
      stick.current = true;
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const changeModel = (m) => {
    setModel(m);
    api(`/streams/${stream.id}`, { method: 'PUT', body: { model: m } }).catch(() => {});
  };

  const visible = (activity || []).filter((e) => showPrompts || e.kind !== 'prompt');

  return (
    <>
      <aside className="drawer" aria-label="Agent Activity">
        <div className="drawer-head">
          <div>
            <div className="eyebrow">Agent Activity</div>
            <h3>
              {stream.ticket.url ? (
                <a href={stream.ticket.url} target="_blank" rel="noreferrer">{stream.ticket.key} <ExternalIcon /></a>
              ) : (
                stream.ticket.key
              )}
            </h3>
            <div className="drawer-summary">{stream.ticket.summary}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close Agent Activity" title="Close Agent Activity"><XIcon /></button>
        </div>

        <div className="drawer-meta">
          <StatusBadge status={stream.status} detail={stream.statusDetail} />
          <span className="chip">{stream.stage}</span>
          <span className="chip cost-chip" title={formatCost(stream).title}>{formatCost(stream).text} spent</span>
          <span className="chip mono"><BranchIcon /> {stream.branch} <CopyButton text={stream.branch} what="branch name" /></span>
          {stream.pr && (
            <a className="chip" href={stream.pr.url} target="_blank" rel="noreferrer">PR #{stream.pr.number} <ExternalIcon /></a>
          )}
          {stream.worktreePath && (
            <span className="chip" title={stream.worktreePath}>
              Worktree <WorktreeTools stream={stream} />
            </span>
          )}
          {stream.worktreePath && !stream.worktreeRemoved && (
            <button className="chip" title={`Open ${stream.worktreePath} in your editor`} onClick={() => api(`/streams/${stream.id}/open`, { method: 'POST', body: { target: 'editor' } }).catch((e) => toast(e.message, 'error'))}>
              <CodeIcon width={13} height={13} /> Open in editor
            </button>
          )}
          <label className="chip toggle-chip">
            <input type="checkbox" checked={showPrompts} onChange={(e) => setShowPrompts(e.target.checked)} /> Show prompts
          </label>
        </div>

        <div
          className="feed"
          ref={feedRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          }}
        >
          {activity === null && <div className="empty"><Spinner /></div>}
          {activity && !visible.length && <div className="empty">No activity yet.</div>}
          {visible.map((e, i) => <Entry key={i} e={e} />)}
        </div>

        <div className="composer">
          <textarea
            rows={3}
            placeholder={busy ? 'An agent is running — stop it to send a prompt' : 'Ask the agent anything about this ticket… (⌘↵ to send)'}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
            }}
          />
          <div className="composer-bar">
            <ModelSelect models={models} value={model} onChange={changeModel} className="model-select" />
            <div className="spacer" />
            {busy && (
              <button className="btn danger-soft" onClick={() => api(`/streams/${stream.id}/stop`, { method: 'POST' }).catch((e) => toast(e.message, 'error'))}>
                <StopIcon width={14} height={14} /> Stop
              </button>
            )}
            <button className="btn primary" onClick={send} disabled={busy || sending || !text.trim()}>
              <SendIcon width={14} height={14} /> Send
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function Entry({ e }) {
  if (e.kind === 'step') {
    return (
      <div className="entry entry-step">
        <span>{e.text}</span>
        <time>{clockTime(e.ts)}</time>
      </div>
    );
  }
  if (e.kind === 'user') {
    return (
      <div className="entry entry-user">
        <div className="bubble">{e.text}</div>
        <time>{clockTime(e.ts)} · {e.model}</time>
      </div>
    );
  }
  if (e.kind === 'prompt') {
    return (
      <details className="entry entry-prompt">
        <summary>Prompt sent{e.model ? ` to ${e.model}` : ''} <time>{clockTime(e.ts)}</time></summary>
        <pre>{e.text}</pre>
      </details>
    );
  }
  return (
    <div className={`entry entry-${e.kind}`}>
      {e.kind === 'agent' && e.model && <div className="entry-who">{e.model}</div>}
      <div className="entry-text">{e.text}</div>
    </div>
  );
}
