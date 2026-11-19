import { api, timeAgo } from '../api.js';
import { Empty, Spinner, StatusBadge } from '../components/ui.jsx';
import { BranchIcon, FolderIcon, RocketIcon } from '../components/Icons.jsx';
import StreamMenu from './StreamMenu.jsx';
import { CopyButton, WorktreeTools, formatCost } from '../components/PathTools.jsx';

const FINISHED = ['Merged', 'Closed', 'Done'];

export default function Streams({ streams, steps = [], loading, error, onOpen, onOpenActivity, activeId }) {
  const open = streams.filter((s) => !FINISHED.includes(s.status));
  const finished = streams.filter((s) => FINISHED.includes(s.status));
  const total = streams.reduce((sum, s) => sum + (s.costUsd || 0), 0);

  const row = (s) => {
    const cost = formatCost(s);
    return (
      <tr key={s.id} className={`clickable ${activeId === s.id ? 'selected' : ''}`} onClick={() => onOpen(s.id)}>
        <td>
          <div className="ticket-cell">
            <span className="key-link plain">{s.ticket.key}</span>
            <span className="summary">{s.ticket.summary}</span>
          </div>
          <div className="branch">
            <BranchIcon /> <span>{s.branch}</span>
            <span onClick={(e) => e.stopPropagation()}><CopyButton text={s.branch} what="branch name" /></span>
          </div>
          {s.worktreePath && (
            <div className="branch worktree-line" title={s.worktreePath}>
              <FolderIcon width={12} height={12} />
              <span className="path-tail">{shortPath(s.worktreePath)}</span>
              <WorktreeTools stream={s} />
            </div>
          )}
        </td>
        <td>
          <span className="stage">{s.stage}</span>
          {s.pr && (
            <a className="muted small pr-link" href={s.pr.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              PR #{s.pr.number}
            </a>
          )}
        </td>
        <td>
          <StatusBadge status={s.status} detail={s.statusDetail} />
          <div className="muted small">{s.statusDetail || timeAgo(s.updatedAt)}</div>
          {s.app?.running && (
            <a
              className="app-chip"
              href={s.app.url || undefined}
              target="_blank"
              rel="noreferrer"
              title={s.app.url ? `App running at ${s.app.url}` : `Starting: ${s.app.command}`}
              onClick={(e) => { e.stopPropagation(); if (!s.app.url) e.preventDefault(); }}
            >
              <RocketIcon width={11} height={11} /> {s.app.url ? s.app.url.replace(/^https?:\/\//, '') : 'app starting…'}
            </a>
          )}
        </td>
        <td className="col-cost" title={cost.title}>
          <span className="cost">{cost.text}</span>
        </td>
        <td className="col-actions" onClick={(e) => e.stopPropagation()}>
          <StreamMenu stream={s} steps={steps} onOpenActivity={() => (onOpenActivity || onOpen)(s.id)} />
        </td>
      </tr>
    );
  };

  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">
          <h2>In-Progress streams</h2>
          {loading && <Spinner />}
          <span className="muted small">{open.length} active · ${total.toFixed(2)} spent</span>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Ticket</th>
              <th className="col-stage">Stage</th>
              <th className="col-status">Status</th>
              <th className="col-cost">Cost</th>
              <th className="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {open.map(row)}
            {finished.length > 0 && (
              <tr className="divider-row"><td colSpan={5}>Finished</td></tr>
            )}
            {finished.map(row)}
          </tbody>
        </table>
        {!streams.length && !loading && <Empty>Claim a ticket to start a stream. Click a stream to open its Agent Activity.</Empty>}
      </div>
    </section>
  );
}

/** Last two path segments, e.g. "demo/other-1". */
function shortPath(p) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p;
}
