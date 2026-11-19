import { useEffect, useRef, useState } from 'react';
import { XIcon } from './Icons.jsx';

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><XIcon /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Tabs({ tabs, value, onChange, onRename, size }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.select();
  }, [editing]);
  const commit = () => {
    if (draft.trim() && editing) onRename?.(editing, draft.trim());
    setEditing(null);
  };
  return (
    <div className={`tabs ${size === 'sm' ? 'tabs-sm' : ''}`} role="tablist">
      {tabs.map((t) =>
        editing === t.id ? (
          <input
            key={t.id}
            ref={inputRef}
            className="tab-rename"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(null);
            }}
            style={{ width: `${Math.max(draft.length, 4) + 2}ch` }}
          />
        ) : (
          <button
            key={t.id}
            role="tab"
            aria-selected={value === t.id}
            className={`tab ${value === t.id ? 'active' : ''}`}
            onClick={() => onChange(t.id)}
            onDoubleClick={() => {
              if (!onRename) return;
              setDraft(t.label);
              setEditing(t.id);
            }}
            title={onRename ? 'Double-click to rename' : undefined}
          >
            {t.label}
            {t.count != null && <span className="tab-count">{t.count}</span>}
          </button>
        ),
      )}
    </div>
  );
}

const STATUS_TONE = {
  Running: 'blue',
  Queued: 'gray',
  'Needs attention': 'red',
  Stopped: 'gray',
  'In Code review': 'purple',
  Merged: 'green',
  Done: 'green',
  Closed: 'gray',
};

export function StatusBadge({ status, detail }) {
  return (
    <span className={`badge tone-${STATUS_TONE[status] || 'gray'}`} title={detail || status}>
      {status === 'Running' && <span className="pulse" />}
      {status}
    </span>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function ModelSelect({ models, value, onChange, allowEmpty, className }) {
  const groups = {};
  for (const m of models || []) (groups[m.harnessLabel] ||= []).push(m);
  const known = (models || []).some((m) => m.value === value);
  return (
    <select className={className} value={value || ''} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">— none —</option>}
      {value && !known && <option value={value}>{value} (unavailable)</option>}
      {Object.entries(groups).map(([label, list]) => (
        <optgroup key={label} label={label}>
          {list.map((m) => (
            <option key={m.value} value={m.value}>{m.model}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
