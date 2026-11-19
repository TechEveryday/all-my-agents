import { useEffect, useRef, useState } from 'react';
import { api, useApi } from '../api.js';
import { toast } from '../App.jsx';
import { ModelSelect, Spinner } from '../components/ui.jsx';

export default function Workflow({ tick }) {
  const wf = useApi('/workflow', [tick]);
  const models = useApi('/models', [tick]);
  const skills = useApi('/skills', [tick]);
  const scripts = useApi('/scripts', [tick]);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    if (wf.data) setDraft(wf.data);
  }, [wf.data]);

  const persist = (next) => {
    setDraft(next);
    setSaved('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await api('/workflow', { method: 'PUT', body: next });
        setSaved('saved');
      } catch (err) {
        setSaved('');
        toast(err.message, 'error');
      }
    }, 400);
  };

  const updateStep = (id, patch) => persist({ ...draft, steps: draft.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const enabledSkills = (skills.data?.skills || []).filter((s) => s.enabled);
  const modelList = models.data?.models || [];
  const effortsFor = (value) => modelList.find((m) => m.value === value)?.efforts ?? ['low', 'medium', 'high', 'xhigh', 'max'];

  if (!draft) return <section className="card"><Spinner /></section>;

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div className="card-title">
            <h2>Workflow</h2>
            <span className="muted small">Runs for every claimed ticket, top to bottom, in its own worktree.</span>
          </div>
          <span className={`save-state ${saved}`}>{saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'All changes saved' : ''}</span>
        </div>
        <datalist id="script-list">{(scripts.data?.scripts || []).map((s) => <option key={s} value={s} />)}</datalist>
        <div className="table-wrap">
          <table className="table workflow-table">
            <thead>
              <tr>
                <th className="col-num">#</th>
                <th>Step</th>
                <th className="col-runs">Runs</th>
                <th className="col-skill">Skill / Script</th>
                <th className="col-model">Model</th>
                <th className="col-effort">Effort</th>
                <th className="col-skip">Skip</th>
              </tr>
            </thead>
            <tbody>
              {draft.steps.map((s, i) => (
                <tr key={s.id} className={s.skip ? 'skipped' : ''}>
                  <td className="col-num">{i + 1}</td>
                  <td>
                    <div className="step-title">{s.title}</div>
                    <div className="muted small">{s.description}</div>
                  </td>
                  <td className="col-runs">
                    <RunsSelect value={s.runs} onChange={(runs) => updateStep(s.id, { runs })} />
                  </td>
                  <td className="col-skill">
                    <SkillOrScript item={s} skills={enabledSkills} onChange={(patch) => updateStep(s.id, patch)} />
                  </td>
                  <td className="col-model">
                    {s.runs === 'script' && s.script ? (
                      <span className="muted small">—</span>
                    ) : (
                      <div className="stack-xs">
                        <ModelSelect models={modelList} value={s.model} onChange={(model) => updateStep(s.id, { model })} />
                        {s.id === 'review' && (
                          <>
                            <ModelSelect models={modelList} value={s.model2} allowEmpty onChange={(model2) => updateStep(s.id, { model2 })} />
                            <span className="muted xsmall">Second reviewer runs in parallel</span>
                          </>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="col-effort">
                    {s.runs === 'script' && s.script ? (
                      <span className="muted small">—</span>
                    ) : effortsFor(s.model).length ? (
                      <select value={s.effort} onChange={(e) => updateStep(s.id, { effort: e.target.value })}>
                        {effortsFor(s.model).map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                    ) : (
                      <span className="muted small" title="This harness doesn't expose an effort setting">n/a</span>
                    )}
                  </td>
                  <td className="col-skip">
                    <input type="checkbox" checked={s.skip} onChange={(e) => updateStep(s.id, { skip: e.target.checked })} aria-label={`Skip ${s.title}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            <h2>Commit</h2>
            <span className="muted small">Not a step — used by every step that commits (Implement, Fix findings, Validation, Resolve PR Feedback).</span>
          </div>
        </div>
        <div className="commit-row">
          <RunsSelect value={draft.commit.runs} onChange={(runs) => persist({ ...draft, commit: { ...draft.commit, runs } })} />
          <SkillOrScript item={draft.commit} skills={enabledSkills} defaultLabel="Default (agent writes a conventional commit)" onChange={(patch) => persist({ ...draft, commit: { ...draft.commit, ...patch } })} />
        </div>
      </section>

      <section className="card subtle">
        <h3>How steps run</h3>
        <ul className="notes">
          <li><strong>Skill</strong> — the step's model is prompted with the selected skill (or a built-in prompt when set to Default) plus the ticket, branch and worktree.</li>
          <li><strong>Script</strong> — a command run in the worktree with <code>AMA_TICKET_KEY</code>, <code>AMA_BRANCH</code>, <code>AMA_BASE</code>, <code>AMA_WORKTREE</code>, <code>AMA_PR_URL</code> and friends set. Exit code 0 means success.</li>
          <li><strong>Watch PR</strong> exits non-zero when checks fail or changes are requested; the stream then runs <strong>Resolve PR Feedback</strong> and watches again (up to the limit in Settings).</li>
          <li>When Watch PR is green the stream moves to <strong>In Code review</strong>.</li>
        </ul>
      </section>
    </div>
  );
}

function RunsSelect({ value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="skill">Skill</option>
      <option value="script">Script</option>
    </select>
  );
}

function SkillOrScript({ item, skills, onChange, defaultLabel = 'Default (built-in prompt)' }) {
  if (item.runs === 'script') {
    return (
      <input
        className="mono"
        list="script-list"
        value={item.script || ''}
        placeholder="scripts/my-step.sh or npm test"
        onChange={(e) => onChange({ script: e.target.value })}
      />
    );
  }
  const known = skills.some((s) => s.name === item.skill);
  return (
    <select value={item.skill || ''} onChange={(e) => onChange({ skill: e.target.value })}>
      <option value="">{defaultLabel}</option>
      {item.skill && !known && <option value={item.skill}>{item.skill} (not enabled)</option>}
      {groupBySource(skills).map(([source, list]) => (
        <optgroup key={source} label={source}>
          {list.map((s) => (
            <option key={s.name} value={s.name} title={s.description}>{s.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function groupBySource(skills) {
  const g = {};
  for (const s of skills) (g[s.source] ||= []).push(s);
  return Object.entries(g);
}
