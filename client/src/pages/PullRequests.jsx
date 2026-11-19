import { useState } from 'react';
import { api, timeAgo, useApi } from '../api.js';
import { toast } from '../App.jsx';
import { Empty, Spinner, Tabs } from '../components/ui.jsx';
import { BranchIcon, CheckIcon } from '../components/Icons.jsx';
import { CopyButton } from '../components/PathTools.jsx';

function readiness(pr) {
  if (pr.isDraft) return { tone: 'gray', label: 'Draft' };
  if (pr.mergeable === 'CONFLICTING' || pr.mergeState === 'DIRTY') return { tone: 'red', label: 'Merge conflicts' };
  if (pr.checks === 'FAILURE' || pr.checks === 'ERROR') return { tone: 'red', label: 'Checks failing' };
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return { tone: 'red', label: 'Changes requested' };
  if (canMerge(pr)) return { tone: 'green', label: 'Ready to merge' };
  if (pr.checks === 'PENDING') return { tone: 'amber', label: 'Checks running' };
  if (pr.mergeState === 'BLOCKED') return { tone: 'amber', label: pr.reviewDecision === 'REVIEW_REQUIRED' ? 'Waiting on review' : 'Blocked' };
  if (pr.mergeState === 'BEHIND') return { tone: 'amber', label: 'Behind base branch' };
  return { tone: 'amber', label: 'Not ready yet' };
}

const canMerge = (pr) => pr.mergeable === 'MERGEABLE' && ['CLEAN', 'HAS_HOOKS', 'UNSTABLE'].includes(pr.mergeState) && !pr.isDraft;

export default function PullRequests({ tick }) {
  const prs = useApi('/prs', [tick]);
  const meta = useApi('/meta');
  const [tab, setTab] = useState('mine');
  const [busy, setBusy] = useState({});
  const me = meta.data?.github?.login;

  const list = tab === 'mine' ? prs.data?.mine || [] : prs.data?.reviewRequested || [];

  const run = async (pr, action, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    const k = `${pr.id}:${action}`;
    setBusy((b) => ({ ...b, [k]: true }));
    try {
      await api(`/prs/${action}`, { method: 'POST', body: { repo: pr.repo, number: pr.number, url: pr.url, branch: pr.branch, base: pr.base, title: pr.title } });
      toast(
        action === 'fix' ? `Fix it started for ${pr.repo}#${pr.number} — see In-Progress streams` : action === 'merge' ? `Merged ${pr.repo}#${pr.number}` : `Approved ${pr.repo}#${pr.number}`,
        'success',
      );
      if (action !== 'fix') prs.reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy((b) => ({ ...b, [k]: false }));
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">
          <h2>Pull Requests</h2>
          {prs.loading && <Spinner />}
        </div>
      </div>
      <Tabs
        size="sm"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'mine', label: 'Mine', count: prs.data?.mine?.length },
          { id: 'review', label: 'Review requested', count: prs.data?.reviewRequested?.length },
        ]}
      />
      {prs.error && <div className="alert">{prs.error}</div>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="col-ready">Ready</th>
              <th className="col-pr">PR</th>
              <th>Title</th>
              <th className="col-updated">Updated</th>
              <th className="col-pr-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((pr) => {
              const r = readiness(pr);
              const mine = pr.author && pr.author === me;
              return (
                <tr key={pr.id}>
                  <td className="col-ready">
                    <span className={`dot dot-${r.tone}`} title={r.label} aria-label={r.label} />
                  </td>
                  <td className="col-pr">
                    <a className="key-link" href={pr.url} target="_blank" rel="noreferrer">{pr.repo.split('/')[1]}#{pr.number}</a>
                  </td>
                  <td>
                    <div className="pr-title">{pr.title}</div>
                    <div className="branch"><BranchIcon /> {pr.branch} <CopyButton text={pr.branch} what="branch name" /> <span className="muted">· {r.label}</span></div>
                  </td>
                  <td className="col-updated muted">{timeAgo(pr.updatedAt)}</td>
                  <td className="col-pr-actions">
                    <button
                      className="btn sm"
                      disabled={mine || busy[`${pr.id}:approve`] || pr.reviewDecision === 'APPROVED'}
                      title={mine ? "You can't approve your own PR" : 'Approve'}
                      onClick={() => run(pr, 'approve', `Approve ${pr.repo}#${pr.number}?`)}
                    >
                      <CheckIcon width={13} height={13} /> Approve
                    </button>
                    {canMerge(pr) && (
                      <button className="btn sm success" disabled={busy[`${pr.id}:merge`]} onClick={() => run(pr, 'merge', `Merge ${pr.repo}#${pr.number} into ${pr.base}? This can't be undone from here.`)}>
                        Merge
                      </button>
                    )}
                    <button className="btn sm primary-soft" disabled={busy[`${pr.id}:fix`]} title="Run the Resolve PR Feedback step on this PR" onClick={() => run(pr, 'fix')}>
                      Fix it
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.length && !prs.loading && <Empty>{tab === 'mine' ? 'No open pull requests.' : 'Nobody is waiting on your review.'}</Empty>}
      </div>
    </section>
  );
}
