import { useEffect, useMemo, useState } from 'react';
import { api, useApi } from '../api.js';
import { toast } from '../App.jsx';
import { Field, ModelSelect, Spinner } from '../components/ui.jsx';
import { FolderIcon, PlusIcon, RefreshIcon, TrashIcon } from '../components/Icons.jsx';

export default function Settings({ tick, onSaved }) {
  return (
    <div className="stack">
      <Workplace tick={tick} onSaved={onSaved} />
      <section className="section-label">Plugins</section>
      <EnvSection tick={tick} />
      <Harnesses tick={tick} onSaved={onSaved} />
      <Skills tick={tick} />
    </div>
  );
}

function FolderInput({ value, onChange, prompt }) {
  const choose = async () => {
    try {
      const r = await api('/system/choose-folder', { method: 'POST', body: { prompt } });
      if (r.path) onChange(r.path);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <div className="input-row">
      <input className="mono" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="/Users/you/repos" />
      <button type="button" className="btn" onClick={choose}><FolderIcon width={15} height={15} /> Choose folder</button>
    </div>
  );
}

function Workplace({ tick, onSaved }) {
  const settings = useApi('/settings', [tick]);
  const models = useApi('/models', [tick]);
  const repos = useApi('/repos', [tick]);
  const [s, setS] = useState(null);
  useEffect(() => {
    if (settings.data) setS(settings.data);
  }, [settings.data]);
  if (!s) return <section className="card"><Spinner /></section>;

  const save = async (patch) => {
    const next = { ...s, ...patch };
    setS(next);
    try {
      await api('/settings', { method: 'PUT', body: next });
      if ('reposRoot' in patch) repos.reload();
      onSaved?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <section className="card">
      <div className="card-head"><div className="card-title"><h2>Workplace</h2></div></div>
      <div className="stack-sm">
        <Field label="Repos folder" hint={repos.data ? `${repos.data.repos.length} git repositor${repos.data.repos.length === 1 ? 'y' : 'ies'} found` : 'Where all of your repos/projects live locally'}>
          <FolderInput value={s.reposRoot} prompt="Choose the folder that holds your repos" onChange={(reposRoot) => save({ reposRoot })} />
        </Field>
        <Field label="Worktrees folder" hint="Each claimed ticket gets a git worktree here, under <repo>/<ticket>">
          <FolderInput value={s.worktreesRoot} prompt="Choose where to create worktrees" onChange={(worktreesRoot) => save({ worktreesRoot })} />
        </Field>

        <div className="checks">
          <label className="check">
            <input type="checkbox" checked={s.autoPickup} onChange={(e) => save({ autoPickup: e.target.checked })} />
            <span>
              <strong>Automatically pick up tickets</strong>
              <span className="muted small">Claim the next unassigned ticket when all of your In-Progress streams are In Code review.</span>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={s.deleteWorktreeOnDone !== false} onChange={(e) => save({ deleteWorktreeOnDone: e.target.checked })} />
            <span>
              <strong>Delete worktrees when tickets are done</strong>
              <span className="muted small">Delete a ticket's local worktree once its PR merges or the ticket is marked done. A worktree with uncommitted or unpushed work is kept.</span>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={s.notifyAttention}
              onChange={(e) => {
                if (e.target.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
                save({ notifyAttention: e.target.checked });
              }}
            />
            <span>
              <strong>Notify me when a stream needs attention</strong>
              <span className="muted small">Desktop notification when a step fails or PR feedback can't be resolved.</span>
            </span>
          </label>
        </div>

        <div className="grid-2">
          <Field label="Branch prefix" hint="e.g. feature/ or your initials — the ticket key and summary follow">
            <input className="mono" value={s.branchPrefix} placeholder="feature/" onChange={(e) => setS({ ...s, branchPrefix: e.target.value })} onBlur={() => save({})} />
          </Field>
          <Field label="Default model" hint="Used for chat in Agent Activity when no model was picked">
            <ModelSelect models={models.data?.models || []} value={s.defaultModel} onChange={(defaultModel) => save({ defaultModel })} />
          </Field>
          <Field label="Agent permissions" hint="How much headless agents may do without asking">
            <select value={s.permissionMode} onChange={(e) => save({ permissionMode: e.target.value })}>
              <option value="auto">Auto (recommended)</option>
              <option value="acceptEdits">Accept edits only</option>
              <option value="bypassPermissions">Bypass all permission checks</option>
            </select>
          </Field>
          <Field label="Merge method">
            <select value={s.mergeMethod} onChange={(e) => save({ mergeMethod: e.target.value })}>
              <option value="squash">Squash</option>
              <option value="merge">Merge commit</option>
              <option value="rebase">Rebase</option>
            </select>
          </Field>
          <Field label="PR feedback attempts" hint="Resolve PR Feedback ⇄ Watch PR loops before asking you">
            <input type="number" min={0} max={10} value={s.maxFeedbackLoops} onChange={(e) => save({ maxFeedbackLoops: Number(e.target.value) })} />
          </Field>
        </div>
      </div>
    </section>
  );
}

function EnvSection({ tick }) {
  const env = useApi('/env', [tick]);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState('');
  useEffect(() => {
    if (env.data) setValues(Object.fromEntries(env.data.fields.map((f) => [f.key, f.value])));
  }, [env.data]);

  const groups = useMemo(() => {
    const g = {};
    for (const f of env.data?.fields || []) (g[f.group] ||= []).push(f);
    return Object.entries(g);
  }, [env.data]);

  const save = async () => {
    setSaving(true);
    try {
      const data = await api('/env', { method: 'PUT', body: { values } });
      env.setData(data);
      toast('Saved to .env', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  const test = async (service) => {
    setTesting(service);
    try {
      const r = await api('/env/test', { method: 'POST', body: { service } });
      toast(r.message, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setTesting('');
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">
          <h2>Environment</h2>
          <span className="muted small">Stored in <code>.env</code> next to the app (git-ignored). Tokens are never sent back to the browser.</span>
        </div>
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save .env'}</button>
      </div>
      <div className="grid-2">
        {groups.map(([group, fields]) => (
          <div key={group} className="env-group">
            <div className="env-group-head">
              <h4>{group}</h4>
              <button className="btn sm" onClick={() => test(group.toLowerCase())} disabled={testing === group.toLowerCase()}>
                {testing === group.toLowerCase() ? 'Testing…' : 'Test connection'}
              </button>
            </div>
            {fields.map((f) => (
              <Field key={f.key} label={<>{f.label} <code className="muted">{f.key}</code></>} hint={f.hint}>
                <input
                  type={f.secret ? 'password' : 'text'}
                  autoComplete="off"
                  value={values[f.key] || ''}
                  placeholder={f.secret ? (f.isSet ? '•••••••• (set — leave blank to keep)' : 'Not set') : f.placeholder}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function Harnesses({ tick, onSaved }) {
  const data = useApi('/harnesses', [tick]);
  const [list, setList] = useState(null);
  const [detecting, setDetecting] = useState(false);
  useEffect(() => {
    if (data.data) setList(data.data.harnesses.map((h) => ({ ...h, customText: (h.customModels || []).join(', ') })));
  }, [data.data]);

  const persist = async (next) => {
    setList(next);
    try {
      const body = Object.fromEntries(next.map((h) => [h.id, { enabled: h.enabled, path: h.path, customModels: h.customText.split(',').map((x) => x.trim()).filter(Boolean) }]));
      await api('/harnesses', { method: 'PUT', body: { harnesses: body } });
      onSaved?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const detect = async () => {
    setDetecting(true);
    try {
      data.setData(await api('/harnesses/detect', { method: 'POST' }));
      toast('Detection finished', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDetecting(false);
    }
  };
  const set = (id, patch) => setList(list.map((h) => (h.id === id ? { ...h, ...patch } : h)));

  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">
          <h2>Agent harnesses</h2>
          <span className="muted small">Installed CLIs that run your workflow steps. Their models show up in the Workflow tab.</span>
        </div>
        <button className="btn" onClick={detect} disabled={detecting}><RefreshIcon width={15} height={15} /> {detecting ? 'Detecting…' : 'Auto-detect'}</button>
      </div>
      {!list ? <Spinner /> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="col-check">On</th>
                <th>Harness</th>
                <th>Path</th>
                <th>Extra models</th>
              </tr>
            </thead>
            <tbody>
              {list.map((h) => (
                <tr key={h.id}>
                  <td className="col-check">
                    <input type="checkbox" checked={h.enabled} onChange={(e) => persist(list.map((x) => (x.id === h.id ? { ...x, enabled: e.target.checked } : x)))} aria-label={`Enable ${h.label}`} />
                  </td>
                  <td>
                    <strong>{h.label}</strong>
                    <div className="small">
                      {h.installed ? <span className="pill pill-green">Installed</span> : h.installed === false ? <span className="pill pill-gray">Not found</span> : null}
                      {h.version && <span className="muted"> {h.version}</span>}
                    </div>
                  </td>
                  <td>
                    <input className="mono" value={h.path || ''} placeholder={h.detectedPath || 'not detected'} onChange={(e) => set(h.id, { path: e.target.value })} onBlur={() => persist(list)} />
                  </td>
                  <td>
                    <input value={h.customText} placeholder="model-a, model-b" onChange={(e) => set(h.id, { customText: e.target.value })} onBlur={() => persist(list)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Skills({ tick }) {
  const skills = useApi('/skills', [tick]);
  const [q, setQ] = useState('');
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  const [custom, setCustom] = useState({ name: '', harness: 'claude', description: '' });

  const list = (skills.data?.skills || []).filter(
    (s) => (!onlyEnabled || s.enabled) && (!q || `${s.name} ${s.description} ${s.source}`.toLowerCase().includes(q.toLowerCase())),
  );

  const toggle = async (name, enabled) => {
    skills.setData((d) => ({ skills: d.skills.map((s) => (s.name === name ? { ...s, enabled } : s)) }));
    await api('/skills', { method: 'PUT', body: { enabled: { [name]: enabled } } }).catch((err) => toast(err.message, 'error'));
  };
  const customList = (skills.data?.skills || []).filter((s) => s.custom).map(({ name, harness, description }) => ({ name, harness, description }));
  const addCustom = async (e) => {
    e.preventDefault();
    if (!custom.name.trim()) return;
    skills.setData(await api('/skills', { method: 'PUT', body: { custom: [...customList, { ...custom, name: custom.name.trim().replace(/^\//, '') }] } }));
    setCustom({ name: '', harness: 'claude', description: '' });
  };
  const removeCustom = async (name) => skills.setData(await api('/skills', { method: 'PUT', body: { custom: customList.filter((c) => c.name !== name) } }));

  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">
          <h2>Skills &amp; plugins</h2>
          <span className="muted small">Found in ~/.claude, ~/.cursor, ~/.codex, installed plugins, marketplaces, and your repos. Enabled skills appear in the Workflow tab's Skill dropdown.</span>
        </div>
        <button className="btn" onClick={() => skills.reload()}><RefreshIcon width={15} height={15} /> Rescan</button>
      </div>
      <div className="input-row">
        <input placeholder="Filter skills…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check inline"><input type="checkbox" checked={onlyEnabled} onChange={(e) => setOnlyEnabled(e.target.checked)} /> Enabled only</label>
      </div>
      <div className="skills-list">
        {skills.loading && !skills.data && <Spinner />}
        {list.map((s) => (
          <label key={s.name} className="skill-row">
            <input type="checkbox" checked={s.enabled} onChange={(e) => toggle(s.name, e.target.checked)} />
            <div className="skill-main">
              <div>
                <span className="mono skill-name">{s.name}</span>
                <span className="src-tag">{s.source}</span>
                {!s.installed && <span className="pill pill-gray">not installed</span>}
              </div>
              {s.description && <div className="muted small clamp">{s.description}</div>}
            </div>
            {s.custom && (
              <button className="icon-btn sm" onClick={(e) => { e.preventDefault(); removeCustom(s.name); }} aria-label={`Remove ${s.name}`}><TrashIcon width={14} height={14} /></button>
            )}
          </label>
        ))}
        {skills.data && !list.length && <div className="empty">No skills match.</div>}
      </div>
      <form className="add-skill" onSubmit={addCustom}>
        <input className="mono" placeholder="Add a skill by name, e.g. my-plugin:commit" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
        <select value={custom.harness} onChange={(e) => setCustom({ ...custom, harness: e.target.value })}>
          <option value="claude">Claude</option>
          <option value="cursor">Cursor</option>
          <option value="codex">Codex</option>
          <option value="any">Any</option>
        </select>
        <button className="btn" type="submit" disabled={!custom.name.trim()}><PlusIcon width={14} height={14} /> Add skill</button>
      </form>
    </section>
  );
}
