import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { toast } from '../App.jsx';
import { Field, Modal } from '../components/ui.jsx';
import { CheckIcon, ExternalIcon, MoreIcon, PlayIcon, SkipIcon, StopIcon, TrashIcon, RocketIcon, ActivityIcon, ChevronIcon } from '../components/Icons.jsx';

const FINISHED = ['Merged', 'Closed', 'Done'];

/** The "⋯" Actions menu for one In-Progress stream. */
export default function StreamMenu({ stream: s, steps, onOpenActivity }) {
  const [open, setOpen] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [pos, setPos] = useState(null);
  const [launching, setLaunching] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const running = s.status === 'Running' || s.status === 'Queued';
  const finished = FINISHED.includes(s.status);
  const hasWorktree = Boolean(s.worktreePath) && !s.worktreeRemoved;
  const canResume = ['Needs attention', 'Stopped'].includes(s.status) && hasWorktree;
  const validateIdx = steps.findIndex((x) => x.id === 'validate');
  const validation = steps[validateIdx];
  const validationSkipped = validation?.skip || s.skipSteps?.includes('validate');
  const validationDone = s.stepIndex > validateIdx && !(s.stepIndex === validateIdx && running);
  const currentStep = steps[s.stepIndex];

  const close = () => {
    setOpen(false);
    setShowSteps(false);
    setPos(null);
  };

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const h = menuRef.current?.offsetHeight || 0;
    const maxTop = window.innerHeight - 8 - h;
    setPos((prev) => {
      // First open: below the button, or above it if there's no room.
      // Expanding "Advance to…": stay put and only slide up as far as needed to fit.
      const top = prev ? Math.min(prev.top, maxTop) : r.bottom + 4 <= maxTop ? r.bottom + 4 : r.top - h - 4;
      return { top: Math.max(8, top), right: window.innerWidth - r.right };
    });
  }, [open, showSteps]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target) && close();
    const onKey = (e) => e.key === 'Escape' && close();
    const onScroll = (e) => !menuRef.current?.contains(e.target) && close();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const run = (fn, confirmText) => async () => {
    close();
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      await fn();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const post = (path, body) => api(`/streams/${s.id}${path}`, { method: 'POST', body });

  return (
    <>
      <button
        ref={btnRef}
        className={`icon-btn sm ${open ? 'active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${s.ticket.key}`}
        title="Actions"
        onClick={(e) => {
          e.stopPropagation();
          open ? close() : setOpen(true);
        }}
      >
        <MoreIcon width={16} height={16} />
      </button>

      {open && (
        <div ref={menuRef} className="menu" role="menu" style={pos ? { top: pos.top, right: pos.right } : { visibility: 'hidden' }} onClick={(e) => e.stopPropagation()}>
          <MenuItem icon={<ActivityIcon />} onClick={run(onOpenActivity)}>Agent Activity</MenuItem>

          {s.app?.running ? (
            <>
              {s.app.url && (
                <MenuItem icon={<ExternalIcon />} onClick={run(async () => window.open(s.app.url, '_blank', 'noopener'))}>
                  Open app <span className="menu-hint">{s.app.url.replace(/^https?:\/\//, '')}</span>
                </MenuItem>
              )}
              <MenuItem icon={<StopIcon />} onClick={run(() => post('/launch/stop'))}>Stop app</MenuItem>
            </>
          ) : (
            <MenuItem icon={<RocketIcon />} disabled={!hasWorktree} onClick={run(async () => setLaunching(true))}>
              Launch app <span className="menu-hint mono">{s.branch}</span>
            </MenuItem>
          )}

          <div className="menu-sep" />

          <MenuItem icon={<StopIcon />} disabled={!running} onClick={run(() => post('/stop'))}>Stop agents</MenuItem>
          {canResume && (
            <MenuItem icon={<PlayIcon />} onClick={run(() => post('/resume'))}>
              {s.status === 'Needs attention' ? 'Retry' : 'Resume'} {currentStep?.title || s.stage}
            </MenuItem>
          )}
          {canResume && currentStep && (
            <MenuItem icon={<SkipIcon />} onClick={run(() => post('/resume', { skip: true }))}>Skip {currentStep.title} and continue</MenuItem>
          )}
          {validation && (
            <MenuItem
              icon={<SkipIcon />}
              disabled={finished || validation.skip || validationDone}
              title={validation.skip ? 'Validation is skipped for every ticket in the Workflow tab' : validationDone ? 'Validation already ran for this ticket' : undefined}
              onClick={run(() => post('/skip', { stepId: 'validate', skip: !s.skipSteps?.includes('validate') }))}
            >
              {validationSkipped && !validation.skip ? "Don't skip Validation" : 'Skip Validation'}
            </MenuItem>
          )}
          <MenuItem icon={<ChevronIcon className={showSteps ? 'rot' : ''} />} disabled={!hasWorktree || finished} onClick={() => setShowSteps((v) => !v)}>
            Advance to…
          </MenuItem>
          {showSteps && (
            <div className="menu-sub">
              {steps.map((st, i) => (
                <MenuItem
                  key={st.id}
                  disabled={st.skip}
                  title={st.skip ? 'Skipped in the Workflow tab' : `Stop what's running and continue from ${st.title}`}
                  onClick={run(() => post('/advance', { stepId: st.id }), `Advance ${s.ticket.key} to "${st.title}"? Running agents stop and the workflow continues from there.`)}
                >
                  <span className="menu-num">{i + 1}</span> {st.title}
                  {i === s.stepIndex && !finished && <span className="menu-hint">current</span>}
                </MenuItem>
              ))}
            </div>
          )}

          <div className="menu-sep" />

          {(!finished || hasWorktree) && (
            <MenuItem
              icon={<CheckIcon />}
              onClick={run(
                () => post('/done'),
                finished
                  ? `Delete the worktree for ${s.ticket.key}?\n${s.worktreePath}\n\nIt is kept if it has uncommitted or unpushed work.`
                  : `Mark ${s.ticket.key} done? Running agents stop and the worktree is deleted (kept if it has uncommitted or unpushed work). The branch stays.`,
              )}
            >
              {finished ? 'Delete worktree' : 'Mark done'}
            </MenuItem>
          )}
          <MenuItem
            icon={<TrashIcon />}
            danger
            onClick={run(() => api(`/streams/${s.id}`, { method: 'DELETE' }), `Remove ${s.ticket.key} from In-Progress streams? Its branch and worktree stay on disk.`)}
          >
            Remove from list
          </MenuItem>
        </div>
      )}

      {launching && <LaunchModal stream={s} onClose={() => setLaunching(false)} />}
    </>
  );
}

function MenuItem({ icon, children, onClick, disabled, danger, title }) {
  return (
    <button role="menuitem" type="button" className={`menu-item ${danger ? 'danger' : ''}`} disabled={disabled} onClick={onClick} title={title}>
      <span className="menu-icon">{icon}</span>
      <span className="menu-label">{children}</span>
    </button>
  );
}

function LaunchModal({ stream, onClose }) {
  const [info, setInfo] = useState(null);
  const [command, setCommand] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/streams/${stream.id}/launch`)
      .then((d) => {
        setInfo(d);
        setCommand(d.command);
      })
      .catch((err) => toast(err.message, 'error'));
  }, [stream.id]);

  const launch = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/streams/${stream.id}/launch`, { method: 'POST', body: { command, remember } });
      toast(`Launching ${stream.ticket.key} — output is in Agent Activity`, 'success');
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Launch ${info?.repo || 'app'} at ${stream.branch}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit" form="launch-form" disabled={busy || !command.trim()}>
            <RocketIcon width={14} height={14} /> {busy ? 'Launching…' : 'Launch'}
          </button>
        </>
      }
    >
      <form id="launch-form" onSubmit={launch} className="stack-sm">
        <p className="muted small">
          Runs in the ticket's worktree with a free <code>PORT</code> set. Its first lines of output and the URL it prints show up in Agent Activity.
        </p>
        <Field label="Command" hint={info && !info.command ? "Couldn't detect how to run this repo — enter the command you use locally." : info?.saved ? `Saved command for ${info.repo}` : 'Detected from the project files'}>
          <input className="mono" autoFocus value={command} placeholder="npm install && npm run dev" onChange={(e) => setCommand(e.target.value)} />
        </Field>
        <label className="check inline">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember this command for {info?.repo || 'this repo'}
        </label>
      </form>
    </Modal>
  );
}
