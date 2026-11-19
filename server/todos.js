// To Do queue: aggregates Jira + GitHub issue sources and "Other" tasks, and
// claims items (branch + worktree + assignment + workflow kick-off).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { state, save, getStream, updateStream, appendActivity } from './store.js';
import { bus } from './events.js';
import * as jira from './jira.js';
import * as github from './github.js';
import { env } from './env.js';
import { createWorktree, githubSlug, slugify, listRepos } from './git.js';
import { runWorkflow, excludeWorkDir, isActive } from './workflow.js';
import { expandHome } from './paths.js';

const cache = new Map(); // sourceId -> { at, items, error }
const TTL = 60 * 1000;

async function fetchSource(src) {
  if (src.type === 'jira') {
    const items = await jira.searchIssues(src.jql || jira.defaultJql(src.project));
    return items.map((i) => ({ ...i, type: 'jira' }));
  }
  const items = await github.listIssues(src.repo, { labels: src.labels });
  return items.map((i) => ({ ...i, type: 'github', key: `${src.repo.split('/')[1]}${i.key}` }));
}

export async function listTodos({ force = false } = {}) {
  // Anything that already has a stream (running or finished) stays out of the queue.
  const claimed = new Set(state.streams.map((s) => s.ticket.id));
  const results = await Promise.all(
    state.sources.map(async (src) => {
      const c = cache.get(src.id);
      if (!force && c && Date.now() - c.at < TTL) return { src, ...c };
      try {
        const items = await fetchSource(src);
        const entry = { at: Date.now(), items, error: null };
        cache.set(src.id, entry);
        return { src, ...entry };
      } catch (err) {
        const entry = { at: Date.now(), items: c?.items || [], error: err.message };
        cache.set(src.id, entry);
        return { src, ...entry };
      }
    }),
  );

  const items = [];
  const errors = [];
  for (const { src, items: list, error } of results) {
    if (error) errors.push({ sourceId: src.id, label: src.label, error });
    for (const i of list) {
      const id = `${src.id}:${i.key}`;
      if (!claimed.has(id)) items.push({ ...i, id, sourceId: src.id });
    }
  }
  for (const t of state.otherTodos) {
    if (!claimed.has(t.id) && !t.done) items.push({ ...t, type: 'other', sourceId: 'other', assignee: env('GITHUB_USERNAME') || 'me' });
  }
  return { items, errors };
}

export function addOther({ summary, description, repo }) {
  state.otherSeq = (state.otherSeq || 0) + 1;
  const t = { id: `other:${crypto.randomUUID()}`, key: `OTHER-${state.otherSeq}`, summary, description: description || '', repo: repo || '', createdAt: new Date().toISOString() };
  state.otherTodos.push(t);
  save();
  bus.emit('todos-changed', {});
  return t;
}

export function removeOther(ids) {
  state.otherTodos = state.otherTodos.filter((t) => !ids.includes(t.id));
  save();
  bus.emit('todos-changed', {});
}

function resolveRepoPath(item, src, override) {
  const root = expandHome(state.settings.reposRoot);
  const candidates = [override, item.repo, src?.localRepo, src?.type === 'github' ? src.repo.split('/')[1] : null].filter(Boolean);
  for (const c of candidates) {
    const p = path.isAbsolute(expandHome(c)) ? expandHome(c) : path.join(root, c);
    if (fs.existsSync(path.join(p, '.git'))) return p;
  }
  return null;
}

export class NeedsRepoError extends Error {
  constructor(item) {
    super(`Pick a local repository for ${item.key}`);
    this.code = 'NEEDS_REPO';
    this.repos = listRepos(state.settings.reposRoot).map((r) => r.name);
  }
}

/** Claim one To Do item. `item` is the object from listTodos(). */
export async function claim(item, { repo } = {}) {
  const src = state.sources.find((s) => s.id === item.sourceId);
  const repoPath = resolveRepoPath(item, src, repo);
  if (!repoPath) throw new NeedsRepoError(item);

  const keySlug = slugify(item.key.replace('#', '-'), 30);
  const branch = `${state.settings.branchPrefix || ''}${keySlug}-${slugify(item.summary, 40)}`.replace(/-+$/, '');
  const stream = {
    id: crypto.randomUUID(),
    ticket: { id: item.id, key: item.key, summary: item.summary, url: item.url || '', type: item.type, sourceId: item.sourceId, description: item.description || '', number: item.number, issueRepo: src?.type === 'github' ? src.repo : undefined },
    repoPath,
    repoName: path.basename(repoPath),
    ghRepo: await githubSlug(repoPath),
    branch,
    base: '',
    worktreePath: '',
    stepIndex: 0,
    stage: 'Claiming',
    status: 'Queued',
    statusDetail: 'Creating branch and worktree',
    sessions: {},
    feedbackLoops: 0,
    model: state.settings.defaultModel,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.streams.unshift(stream);
  save();
  bus.emit('stream', stream);
  bus.emit('todos-changed', {});
  const log = (text, kind = 'system') => appendActivity(stream.id, { kind, step: 'Claim', text });
  log(`Claiming ${item.key}: ${item.summary}`, 'step');

  // Run the slow part in the background so the UI returns immediately.
  (async () => {
    try {
      const wt = await createWorktree({ repoPath, worktreesRoot: state.settings.worktreesRoot, branch, dirName: keySlug, log });
      await excludeWorkDir(wt.worktreePath);
      updateStream(stream.id, { worktreePath: wt.worktreePath, base: wt.base, statusDetail: '' });
      log(`Worktree ready at ${wt.worktreePath}`);
      await assign(item, src, log);
      runWorkflow(stream.id);
    } catch (err) {
      log(err.message, 'error');
      updateStream(stream.id, { status: 'Needs attention', statusDetail: 'Claim failed' });
    }
  })();
  return stream;
}

async function assign(item, src, log) {
  try {
    if (item.type === 'jira') {
      await jira.assignToMe(item.key);
      log(`Assigned ${item.key} to you in Jira`);
      if (await jira.startProgress(item.key).catch(() => false)) log(`Moved ${item.key} to In Progress`);
    } else if (item.type === 'github') {
      const login = await github.username();
      if (!login) throw new Error('Set GITHUB_USERNAME to assign GitHub issues');
      await github.assignIssue(src.repo, item.number, login);
      log(`Assigned ${src.repo}#${item.number} to @${login}`);
    }
  } catch (err) {
    log(`Could not assign ticket: ${err.message}`, 'error');
  }
}

/** "Fix it" on a PR: reuse its stream, or create one with a worktree on the PR branch. */
export async function fixPullRequest(pr) {
  const prIdx = state.workflow.steps.findIndex((s) => s.id === 'pr-feedback');
  let stream = state.streams.find((s) => s.pr?.url === pr.url || (s.ghRepo === pr.repo && s.branch === pr.branch));
  if (stream) {
    if (isActive(stream.id)) throw new Error('An agent is already running for this PR.');
    updateStream(stream.id, { stepIndex: prIdx, feedbackLoops: 0, forceFeedback: true, pr: { number: pr.number, url: pr.url } });
    appendActivity(stream.id, { kind: 'step', text: 'Fix it requested from Pull Requests' });
    runWorkflow(stream.id);
    return stream;
  }

  const repoName = pr.repo.split('/')[1];
  const repoPath = path.join(expandHome(state.settings.reposRoot), repoName);
  if (!fs.existsSync(path.join(repoPath, '.git'))) throw new Error(`No local clone of ${pr.repo} at ${repoPath}`);
  stream = {
    id: crypto.randomUUID(),
    ticket: { id: `pr:${pr.url}`, key: `${repoName}#${pr.number}`, summary: pr.title, url: pr.url, type: 'pr' },
    repoPath,
    repoName,
    ghRepo: pr.repo,
    branch: pr.branch,
    base: pr.base || '',
    worktreePath: '',
    stepIndex: prIdx,
    stage: 'Resolve PR Feedback',
    status: 'Queued',
    statusDetail: 'Checking out PR branch',
    pr: { number: pr.number, url: pr.url },
    sessions: {},
    feedbackLoops: 0,
    forceFeedback: true,
    model: state.settings.defaultModel,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.streams.unshift(stream);
  save();
  bus.emit('stream', stream);
  const log = (text, kind = 'system') => appendActivity(stream.id, { kind, step: 'Fix it', text });
  (async () => {
    try {
      const wt = await createWorktree({ repoPath, worktreesRoot: state.settings.worktreesRoot, branch: pr.branch, dirName: `pr-${pr.number}`, existingRemoteBranch: pr.branch, log });
      await excludeWorkDir(wt.worktreePath);
      updateStream(stream.id, { worktreePath: wt.worktreePath, base: pr.base || wt.base, statusDetail: '' });
      runWorkflow(stream.id);
    } catch (err) {
      log(err.message, 'error');
      updateStream(stream.id, { status: 'Needs attention', statusDetail: 'Checkout failed' });
    }
  })();
  return stream;
}

let lastPickupAttempt = 0;
/** Auto pickup: claim the next ticket when every open stream is in code review. */
export async function autoPickup() {
  if (!state.settings.autoPickup) return;
  if (Date.now() - lastPickupAttempt < 5 * 60 * 1000) return;
  const open = state.streams.filter((s) => !['Merged', 'Closed', 'Done'].includes(s.status));
  if (!open.every((s) => s.status === 'In Code review')) return;
  lastPickupAttempt = Date.now();
  const { items } = await listTodos({ force: true });
  const next = items.find((i) => i.type !== 'other' && !i.assignee);
  if (!next) return;
  try {
    const s = await claim(next);
    appendActivity(s.id, { kind: 'system', step: 'Claim', text: 'Picked up automatically (all other streams are in code review)' });
  } catch (err) {
    bus.emit('notice', { title: 'Auto pickup failed', text: `${next.key}: ${err.message}` });
  }
}

export function resumeAfterRestart() {
  // Anything that was mid-run when the server stopped is now stopped.
  for (const s of state.streams) {
    if (s.status === 'Running' || s.status === 'Queued') updateStream(s.id, { status: 'Stopped', statusDetail: 'Server restarted' });
  }
}

export { getStream };
