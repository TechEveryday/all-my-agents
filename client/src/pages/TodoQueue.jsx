import { useMemo, useState } from 'react';
import { api, useApi, useEvent } from '../api.js';
import { toast } from '../App.jsx';
import { Empty, Field, Modal, Spinner, Tabs } from '../components/ui.jsx';
import { ExternalIcon, GearIcon, PlusIcon, TrashIcon } from '../components/Icons.jsx';

export default function TodoQueue({ tick, onClaimed }) {
  const sources = useApi('/sources', [tick]);
  const todos = useApi('/todos', [tick]);
  const repos = useApi('/repos', [tick]);
  const [tab, setTab] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [modal, setModal] = useState(null); // 'sources' | 'add' | { needsRepo, ids }
  const [claiming, setClaiming] = useState(new Set());

  useEvent('todos-changed', () => {
    todos.reload();
    sources.reload();
  });

  const srcList = sources.data?.sources || [];
  const tabNames = sources.data?.tabNames || { all: 'All', other: 'Other' };
  const items = todos.data?.items || [];
  const errors = todos.data?.errors || [];
  const srcById = Object.fromEntries(srcList.map((s) => [s.id, s]));

  const visible = useMemo(() => (tab === 'all' ? items : items.filter((i) => i.sourceId === tab)), [items, tab]);
  const tabs = [
    { id: 'all', label: tabNames.all, count: items.length },
    ...srcList.map((s) => ({ id: s.id, label: s.label, count: items.filter((i) => i.sourceId === s.id).length })),
    { id: 'other', label: tabNames.other, count: items.filter((i) => i.type === 'other').length },
  ];
  const selectedVisible = visible.filter((i) => selected.has(i.id));
  const allChecked = visible.length > 0 && selectedVisible.length === visible.length;

  const rename = async (id, name) => {
    try {
      const data = await api('/tabs/rename', { method: 'POST', body: { id, name } });
      sources.setData((d) => ({ ...d, ...data }));
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const claim = async (ids, repo) => {
    setClaiming((c) => new Set([...c, ...ids]));
    try {
      const { streams } = await api('/todos/claim', { method: 'POST', body: { ids, repo } });
      toast(`Claimed ${streams.map((s) => s.ticket.key).join(', ')} — workflow starting`, 'success');
      setSelected((s) => new Set([...s].filter((x) => !ids.includes(x))));
      todos.reload();
      onClaimed?.(streams);
    } catch (err) {
      if (err.code === 'NEEDS_REPO') setModal({ needsRepo: true, ids, repos: err.body.repos, message: err.message });
      else toast(err.message, 'error');
    } finally {
      setClaiming((c) => new Set([...c].filter((x) => !ids.includes(x))));
    }
  };

  const removeOther = async () => {
    const ids = selectedVisible.filter((i) => i.type === 'other').map((i) => i.id);
    if (!ids.length || !window.confirm(`Remove ${ids.length} task${ids.length === 1 ? '' : 's'} from Other?`)) return;
    await api('/todos/other', { method: 'DELETE', body: { ids } });
    setSelected(new Set());
    todos.reload();
  };

  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">
          <h2>To Do</h2>
          {todos.loading && <Spinner />}
        </div>
        <div className="toolbar">
          {selectedVisible.length > 0 && (
            <>
              {selectedVisible.some((i) => i.type === 'other') && (
                <button className="btn ghost" onClick={removeOther}><TrashIcon width={15} height={15} /> Remove</button>
              )}
              <button className="btn primary" onClick={() => claim(selectedVisible.map((i) => i.id))}>
                Claim {selectedVisible.length}
              </button>
            </>
          )}
          <button className="btn" onClick={() => setModal('add')} title="Add a task to Other">
            <PlusIcon width={15} height={15} /> Add
          </button>
          <button className="icon-btn" onClick={() => setModal('sources')} title="Configure where To Do items come from" aria-label="Configure sources">
            <GearIcon />
          </button>
        </div>
      </div>

      <Tabs tabs={tabs} value={tab} onChange={(t) => { setTab(t); setSelected(new Set()); }} onRename={rename} size="sm" />

      {errors.length > 0 && (
        <div className="alert">
          {errors.map((e) => (
            <div key={e.sourceId}><strong>{e.label}:</strong> {e.error}</div>
          ))}
        </div>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="col-check">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allChecked}
                  onChange={() => setSelected(allChecked ? new Set() : new Set(visible.map((i) => i.id)))}
                />
              </th>
              <th className="col-key">Key</th>
              <th>Summary</th>
              <th className="col-assignee">Unassigned</th>
              <th className="col-action">Claim</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((i) => (
              <tr key={i.id} className={selected.has(i.id) ? 'selected' : ''} onClick={() => toggle(i.id)}>
                <td className="col-check" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} aria-label={`Select ${i.key}`} />
                </td>
                <td className="col-key">
                  {i.url ? (
                    <a href={i.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="key-link">
                      {i.key}
                    </a>
                  ) : (
                    <span className="key-link plain">{i.key}</span>
                  )}
                  {tab === 'all' && <span className={`src-tag src-${i.type}`}>{i.type === 'other' ? tabNames.other : srcById[i.sourceId]?.label}</span>}
                </td>
                <td className="summary">
                  {i.summary}
                  {i.status && <span className="muted small"> · {i.status}</span>}
                </td>
                <td className="col-assignee">
                  {i.assignee ? <span className="muted">{i.assignee}</span> : <span className="pill pill-green">Unassigned</span>}
                </td>
                <td className="col-action" onClick={(e) => e.stopPropagation()}>
                  <button className="btn sm primary-soft" disabled={claiming.has(i.id)} onClick={() => claim([i.id])}>
                    {claiming.has(i.id) ? <Spinner /> : 'Claim'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && !todos.loading && (
          <Empty>
            {tab === 'other' ? (
              <>Nothing here yet. Use <strong>Add</strong> for tasks that aren't a Jira ticket or GitHub issue.</>
            ) : srcList.length === 0 && tab === 'all' && items.length === 0 ? (
              <>No sources yet. Click the <GearIcon width={14} height={14} /> to pull in Jira or GitHub issues.</>
            ) : (
              'Queue is empty. Nice.'
            )}
          </Empty>
        )}
      </div>

      {modal === 'sources' && (
        <SourcesModal
          sources={srcList}
          jiraConfigured={sources.data?.jiraConfigured}
          repos={repos.data?.repos || []}
          onClose={() => setModal(null)}
          onSaved={(data) => {
            sources.setData((d) => ({ ...d, ...data }));
            todos.reload('/todos?force=1');
            setModal(null);
          }}
        />
      )}
      {modal === 'add' && (
        <AddOtherModal
          repos={repos.data?.repos || []}
          onClose={() => setModal(null)}
          onAdded={() => {
            todos.reload();
            setTab('other');
            setModal(null);
          }}
        />
      )}
      {modal?.needsRepo && (
        <RepoPicker
          message={modal.message}
          repos={modal.repos}
          onClose={() => setModal(null)}
          onPick={(repo) => {
            const ids = modal.ids;
            setModal(null);
            claim(ids, repo);
          }}
        />
      )}
    </section>
  );
}

function SourcesModal({ sources, jiraConfigured, repos, onClose, onSaved }) {
  const [list, setList] = useState(sources.map((s) => ({ ...s })));
  const [saving, setSaving] = useState(false);
  const update = (i, patch) => setList((l) => l.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const add = (type) => setList((l) => [...l, type === 'jira' ? { type, label: 'Jira', project: '', jql: '', localRepo: '' } : { type, label: '', repo: '', labels: '', localRepo: '' }]);

  const save = async () => {
    setSaving(true);
    try {
      const cleaned = list.map((s) => (s.type === 'github' && !s.label ? { ...s, label: `GH - ${(s.repo || '').split('/')[1] || 'repo'}` } : s));
      if (cleaned.some((s) => s.type === 'github' && !/^[\w.-]+\/[\w.-]+$/.test(s.repo))) throw new Error('GitHub sources need a repository like owner/name');
      onSaved(await api('/sources', { method: 'PUT', body: { sources: cleaned } }));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="To Do sources"
      wide
      onClose={onClose}
      footer={
        <>
          <div className="foot-left">
            <button className="btn" onClick={() => add('jira')}><PlusIcon width={14} height={14} /> Jira board</button>
            <button className="btn" onClick={() => add('github')}><PlusIcon width={14} height={14} /> GitHub repo</button>
          </div>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <p className="muted small">
        Each source becomes a tab in the queue. Credentials (Jira token, GitHub token, usernames) live in <code>.env</code> — edit them in Settings › Plugins.
        {!jiraConfigured && list.some((s) => s.type === 'jira') && <span className="warn-text"> Jira credentials aren't set yet.</span>}
      </p>
      <datalist id="repo-names">{repos.map((r) => <option key={r.name} value={r.name} />)}</datalist>
      {!list.length && <Empty>No sources. Add a Jira board or a GitHub repository below.</Empty>}
      {list.map((s, i) => (
        <div className="source-card" key={s.id || i}>
          <div className="source-card-head">
            <span className={`src-tag src-${s.type}`}>{s.type === 'jira' ? 'Jira' : 'GitHub issues'}</span>
            <button className="icon-btn sm" onClick={() => setList((l) => l.filter((_, j) => j !== i))} aria-label="Remove source"><TrashIcon width={15} height={15} /></button>
          </div>
          <div className="grid-2">
            <Field label="Tab name">
              <input value={s.label} placeholder={s.type === 'github' ? `GH - ${(s.repo || 'repo').split('/').pop()}` : 'Jira'} onChange={(e) => update(i, { label: e.target.value })} />
            </Field>
            {s.type === 'jira' ? (
              <Field label="Project key" hint="Used for the default JQL">
                <input value={s.project} placeholder="PROJ" onChange={(e) => update(i, { project: e.target.value.toUpperCase() })} />
              </Field>
            ) : (
              <Field label="Repository">
                <input value={s.repo} placeholder="owner/name" onChange={(e) => update(i, { repo: e.target.value.trim() })} />
              </Field>
            )}
            {s.type === 'jira' ? (
              <Field label="JQL (optional)" hint="Defaults to open tickets that are unassigned or yours">
                <input value={s.jql} placeholder={`project = ${s.project || 'PROJ'} AND statusCategory != Done AND (assignee is EMPTY OR assignee = currentUser())`} onChange={(e) => update(i, { jql: e.target.value })} />
              </Field>
            ) : (
              <Field label="Labels (optional)" hint="Comma separated">
                <input value={s.labels} placeholder="good first issue,bug" onChange={(e) => update(i, { labels: e.target.value })} />
              </Field>
            )}
            <Field label="Local repo" hint={s.type === 'jira' ? 'Folder in your repos folder where claimed tickets get a worktree' : 'Defaults to the repo name in your repos folder'}>
              <input list="repo-names" value={s.localRepo} placeholder={s.type === 'github' ? (s.repo || '').split('/')[1] || 'repo-folder' : 'repo-folder'} onChange={(e) => update(i, { localRepo: e.target.value })} />
            </Field>
          </div>
        </div>
      ))}
    </Modal>
  );
}

function AddOtherModal({ repos, onClose, onAdded }) {
  const [form, setForm] = useState({ summary: '', description: '', repo: '' });
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api('/todos/other', { method: 'POST', body: form });
      toast('Added to Other', 'success');
      onAdded();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <Modal
      title="Add a task"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" form="add-other" type="submit" disabled={!form.summary.trim()}>Add</button>
        </>
      }
    >
      <form id="add-other" onSubmit={submit} className="stack-sm">
        <Field label="Summary">
          <input autoFocus value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="What needs to get done?" />
        </Field>
        <Field label="Notes (optional)" hint="Given to the agent as context if you claim this task">
          <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Repository (optional)" hint="Needed only if you want to claim it and let agents work on it">
          <select value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })}>
            <option value="">— none —</option>
            {repos.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
          </select>
        </Field>
      </form>
    </Modal>
  );
}

function RepoPicker({ message, repos, onClose, onPick }) {
  const [repo, setRepo] = useState(repos?.[0] || '');
  return (
    <Modal
      title="Which repository?"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!repo} onClick={() => onPick(repo)}>Claim</button>
        </>
      }
    >
      <p>{message}. The branch and worktree will be created from this repository.</p>
      {repos?.length ? (
        <Field label="Repository">
          <select value={repo} onChange={(e) => setRepo(e.target.value)}>
            {repos.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
      ) : (
        <p className="warn-text">No git repositories found in your repos folder. Set it in Settings › Workplace.</p>
      )}
      <p className="muted small"><ExternalIcon /> Tip: set a default "Local repo" on the source (gear icon) to skip this question.</p>
    </Modal>
  );
}
