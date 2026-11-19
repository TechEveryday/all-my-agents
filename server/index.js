// All My Agents — local server. Binds to 127.0.0.1 only: it holds your tokens
// and can run agents on your machine.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT, SCRIPTS_DIR } from './paths.js';
import { state, save, getStream, updateStream, readActivity, appendActivity } from './store.js';
import { sseHandler, bus } from './events.js';
import { publicEnv, writeEnv, env, ENV_FIELDS } from './env.js';
import { appCommit, listRepos } from './git.js';
import { exec, killAll } from './proc.js';
import { HARNESSES, detect, availableModels, harnessSummary } from './harness.js';
import { discoverSkills } from './skills.js';
import * as jira from './jira.js';
import * as github from './github.js';
import { runWorkflow, stopStream, promptStream, isActive, pollStreams, finishStream, cleanupWorktree, FINISHED, advanceTo, setStepSkipped } from './workflow.js';
import { suggestedCommand, launchApp, stopApp, stopAllApps, resetApps } from './launch.js';
import { listTodos, addOther, removeOther, claim, fixPullRequest, autoPickup, resumeAfterRestart } from './todos.js';

const PORT = Number(process.env.PORT || 4317);
const DEV = process.argv.includes('--dev');
const app = express();
app.use(express.json({ limit: '2mb' }));

const route = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (err) {
    res.status(err.status || (err.code === 'NEEDS_REPO' ? 409 : 500)).json({ error: err.message, code: err.code, repos: err.repos });
  }
};

// ---- meta / header ----------------------------------------------------------
app.get('/api/meta', route(async () => {
  const login = env('GITHUB_USERNAME') || (await github.whoami().catch(() => ''));
  return { platform: process.platform, commit: await appCommit(), github: { login, url: login ? `https://github.com/${login}` : 'https://github.com' } };
}));
app.get('/api/events', sseHandler);

app.post('/api/agents/stop-all', route(() => {
  for (const s of state.streams) if (isActive(s.id)) updateStream(s.id, { stopRequested: true });
  const killed = killAll();
  return { killed };
}));

// ---- To Do queue ------------------------------------------------------------
app.get('/api/todos', route((req) => listTodos({ force: req.query.force === '1' })));
app.post('/api/todos/other', route((req) => {
  if (!req.body.summary?.trim()) throw Object.assign(new Error('Summary is required'), { status: 400 });
  return addOther(req.body);
}));
app.delete('/api/todos/other', route((req) => removeOther(req.body.ids || [])));
app.post('/api/todos/claim', route(async (req) => {
  const { items } = await listTodos();
  const picked = (req.body.ids || []).map((id) => items.find((i) => i.id === id)).filter(Boolean);
  if (!picked.length) throw Object.assign(new Error('Nothing to claim — refresh the queue'), { status: 400 });
  const streams = [];
  for (const item of picked) streams.push(await claim(item, { repo: req.body.repo }));
  return { streams };
}));

app.get('/api/sources', route(() => ({ sources: state.sources, tabNames: state.tabNames, jiraConfigured: jira.jiraConfigured() })));
app.put('/api/sources', route((req) => {
  state.sources = (req.body.sources || []).map((s) => ({
    id: s.id || `${s.type}-${Math.random().toString(36).slice(2, 8)}`,
    type: s.type === 'jira' ? 'jira' : 'github',
    label: s.label || (s.type === 'jira' ? 'Jira' : `GH - ${(s.repo || '').split('/')[1] || 'repo'}`),
    jql: s.jql || '',
    project: s.project || '',
    repo: s.repo || '',
    labels: s.labels || '',
    localRepo: s.localRepo || '',
  }));
  if (req.body.tabNames) state.tabNames = { ...state.tabNames, ...req.body.tabNames };
  save();
  bus.emit('todos-changed', {});
  return { sources: state.sources, tabNames: state.tabNames };
}));
app.post('/api/tabs/rename', route((req) => {
  const { id, name } = req.body;
  if (!name?.trim()) throw Object.assign(new Error('Name is required'), { status: 400 });
  if (id === 'all' || id === 'other') state.tabNames[id] = name.trim();
  else {
    const src = state.sources.find((s) => s.id === id);
    if (!src) throw Object.assign(new Error('Unknown tab'), { status: 404 });
    src.label = name.trim();
  }
  save();
  return { sources: state.sources, tabNames: state.tabNames };
}));

// ---- streams ----------------------------------------------------------------
app.get('/api/streams', route(() => ({ streams: state.streams.map((s) => ({ ...s, busy: isActive(s.id) })) })));
app.get('/api/streams/:id/activity', route((req) => ({ activity: readActivity(req.params.id) })));
app.post('/api/streams/:id/prompt', route((req) => {
  const { text, model } = req.body;
  if (!text?.trim()) throw Object.assign(new Error('Prompt is empty'), { status: 400 });
  if (isActive(req.params.id)) throw Object.assign(new Error('An agent is already running for this stream. Stop it first.'), { status: 409 });
  promptStream(req.params.id, text.trim(), model).catch((err) => appendActivity(req.params.id, { kind: 'error', text: err.message }));
  return { ok: true };
}));
app.put('/api/streams/:id', route((req) => updateStream(req.params.id, { model: req.body.model, effort: req.body.effort })));
app.post('/api/streams/:id/stop', route((req) => ({ killed: stopStream(req.params.id) })));
app.post('/api/streams/:id/resume', route((req) => {
  const s = getStream(req.params.id);
  if (!s) throw Object.assign(new Error('Unknown stream'), { status: 404 });
  if (!s.worktreePath) throw Object.assign(new Error('This stream has no worktree yet'), { status: 400 });
  if (req.body?.skip) {
    appendActivity(s.id, { kind: 'step', text: `Skipped ${state.workflow.steps[s.stepIndex]?.title || 'step'} manually` });
    updateStream(s.id, { stepIndex: s.stepIndex + 1 });
  }
  runWorkflow(s.id);
  return { ok: true };
}));
function openInFileManager(dir) {
  if (process.platform === 'darwin') return exec('open', [dir]);
  if (process.platform === 'win32') return exec('explorer.exe', [dir]).then(() => ({ ok: true })); // explorer exits 1 on success
  return exec('xdg-open', [dir]);
}

app.post('/api/streams/:id/open', route(async (req) => {
  const s = getStream(req.params.id);
  if (!s?.worktreePath || s.worktreeRemoved || !fs.existsSync(s.worktreePath)) throw Object.assign(new Error('This worktree no longer exists'), { status: 400 });
  if (req.body?.target === 'editor') {
    const editor = state.harnesses.cursor?.enabled ? 'cursor' : 'code';
    const r = await exec(editor, [s.worktreePath]);
    if (r.ok) return { ok: true };
  }
  const r = await openInFileManager(s.worktreePath);
  if (!r.ok) throw new Error(`Could not open ${s.worktreePath}: ${r.stderr.trim()}`);
  return { ok: true };
}));
app.post('/api/streams/:id/advance', route(async (req) => {
  await advanceTo(req.params.id, req.body.stepId);
  return { ok: true };
}));
app.post('/api/streams/:id/skip', route(async (req) => {
  await setStepSkipped(req.params.id, req.body.stepId, req.body.skip !== false);
  return { ok: true };
}));
app.get('/api/streams/:id/launch', route((req) => {
  const s = getStream(req.params.id);
  if (!s) throw Object.assign(new Error('Unknown stream'), { status: 404 });
  return { ...suggestedCommand(s), repo: s.repoName, branch: s.branch, worktreePath: s.worktreePath };
}));
app.post('/api/streams/:id/launch', route((req) => launchApp(req.params.id, req.body.command, { remember: req.body.remember })));
app.post('/api/streams/:id/launch/stop', route((req) => ({ stopped: stopApp(req.params.id) })));
app.post('/api/streams/:id/done', route(async (req) => {
  const s = getStream(req.params.id);
  if (!s) throw Object.assign(new Error('Unknown stream'), { status: 404 });
  if (FINISHED.includes(s.status)) return cleanupWorktree(s.id, { merged: s.status === 'Merged' });
  await finishStream(s.id, 'Done', '✓ Marked done');
  return { ok: true };
}));
app.delete('/api/streams/:id', route((req) => {
  stopStream(req.params.id);
  stopApp(req.params.id);
  state.streams = state.streams.filter((s) => s.id !== req.params.id);
  save();
  bus.emit('stream-removed', { id: req.params.id });
  bus.emit('todos-changed', {});
  return { ok: true };
}));

// ---- workflow ---------------------------------------------------------------
app.get('/api/workflow', route(() => state.workflow));
app.put('/api/workflow', route((req) => {
  const byId = Object.fromEntries((req.body.steps || []).map((s) => [s.id, s]));
  state.workflow.steps = state.workflow.steps.map((s) => ({ ...s, ...pick(byId[s.id], ['runs', 'skill', 'script', 'model', 'model2', 'effort', 'skip']) }));
  if (req.body.commit) state.workflow.commit = pick(req.body.commit, ['runs', 'skill', 'script']);
  save();
  return state.workflow;
}));
app.get('/api/models', route(async () => ({ models: await availableModels() })));
app.get('/api/scripts', route(() => ({
  scripts: fs.existsSync(SCRIPTS_DIR) ? fs.readdirSync(SCRIPTS_DIR).filter((f) => !f.startsWith('.')).map((f) => `scripts/${f}`) : [],
})));

// ---- settings ---------------------------------------------------------------
app.get('/api/settings', route(() => state.settings));
app.put('/api/settings', route((req) => {
  const allowed = ['reposRoot', 'worktreesRoot', 'branchPrefix', 'autoPickup', 'deleteWorktreeOnDone', 'notifyAttention', 'permissionMode', 'mergeMethod', 'maxFeedbackLoops', 'defaultModel'];
  Object.assign(state.settings, pick(req.body, allowed));
  save();
  return state.settings;
}));
app.get('/api/repos', route(() => ({ repos: listRepos(state.settings.reposRoot) })));
app.post('/api/system/choose-folder', route(async (req) => {
  if (process.platform !== 'darwin') throw Object.assign(new Error('Native folder picker is only available on macOS — type the path instead.'), { status: 501 });
  const prompt = String(req.body?.prompt || 'Choose a folder').replace(/"/g, '');
  const r = await exec('osascript', ['-e', `POSIX path of (choose folder with prompt "${prompt}")`], { timeout: 5 * 60 * 1000 });
  if (!r.ok) return { path: null }; // cancelled
  return { path: r.stdout.trim().replace(/\/$/, '') };
}));

app.get('/api/env', route(() => ({ fields: publicEnv() })));
app.put('/api/env', route((req) => {
  const known = new Set(ENV_FIELDS.map((f) => f.key));
  const updates = {};
  for (const [k, v] of Object.entries(req.body.values || {})) {
    if (!known.has(k)) continue;
    const field = ENV_FIELDS.find((f) => f.key === k);
    if (field.secret && !v) continue; // blank secret = keep existing
    updates[k] = String(v).trim();
  }
  for (const k of req.body.clear || []) if (known.has(k)) updates[k] = '';
  writeEnv(updates);
  return { fields: publicEnv() };
}));
app.post('/api/env/test', route(async (req) => {
  if (req.body.service === 'jira') {
    const me = await jira.getMyself();
    return { ok: true, message: `Connected to Jira as ${me.displayName} (${me.emailAddress || me.accountId})` };
  }
  const login = await github.whoami();
  return { ok: true, message: `Connected to GitHub as @${login}${env('GITHUB_TOKEN') ? '' : ' (via gh CLI token)'}` };
}));

app.get('/api/harnesses', route(() => ({ harnesses: harnessSummary() })));
app.put('/api/harnesses', route((req) => {
  for (const [id, cfg] of Object.entries(req.body.harnesses || {})) {
    if (!HARNESSES[id]) continue;
    state.harnesses[id] = {
      ...state.harnesses[id],
      ...pick(cfg, ['enabled', 'path']),
      customModels: Array.isArray(cfg.customModels) ? cfg.customModels.map((m) => String(m).trim()).filter(Boolean) : state.harnesses[id].customModels,
    };
  }
  save();
  return { harnesses: harnessSummary() };
}));
app.post('/api/harnesses/detect', route(async () => {
  const results = await Promise.all(Object.keys(HARNESSES).map(detect));
  for (const r of results) {
    const cfg = state.harnesses[r.id];
    if (r.path && !cfg.path) cfg.path = r.path;
    cfg.version = r.version;
    cfg.installed = r.installed;
    cfg.detectedPath = r.path;
  }
  save();
  return { harnesses: harnessSummary() };
}));

app.get('/api/skills', route(() => ({ skills: discoverSkills() })));
app.put('/api/skills', route((req) => {
  if (req.body.enabled) state.skills.enabled = { ...state.skills.enabled, ...req.body.enabled };
  if (req.body.custom) state.skills.custom = req.body.custom.filter((c) => c.name?.trim());
  save();
  return { skills: discoverSkills() };
}));

// ---- pull requests ----------------------------------------------------------
app.get('/api/prs', route(() => github.listPullRequests()));
app.post('/api/prs/approve', route((req) => github.approvePullRequest(req.body.repo, req.body.number).then(() => ({ ok: true }))));
app.post('/api/prs/merge', route((req) => github.mergePullRequest(req.body.repo, req.body.number, state.settings.mergeMethod).then(() => ({ ok: true }))));
app.post('/api/prs/fix', route(async (req) => ({ stream: await fixPullRequest(req.body) })));

app.use('/api', (req, res) => res.status(404).json({ error: `No route ${req.method} ${req.path}` }));

function pick(obj = {}, keys) {
  return Object.fromEntries(keys.filter((k) => obj && k in obj).map((k) => [k, obj[k]]));
}

// ---- client -----------------------------------------------------------------
if (DEV) {
  const { createServer } = await import('vite');
  const vite = await createServer({ configFile: path.join(APP_ROOT, 'vite.config.js'), server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  const dist = path.join(APP_ROOT, 'dist');
  if (!fs.existsSync(dist)) {
    console.error('No build found. Run `npm run build` (or use `npm run dev`).');
    process.exit(1);
  }
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// ---- background loops -------------------------------------------------------
resumeAfterRestart();
resetApps();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopAllApps(); process.exit(0); });
if (!state.harnesses.claude.detectedPath) {
  Promise.all(Object.keys(HARNESSES).map(detect)).then((results) => {
    for (const r of results) Object.assign(state.harnesses[r.id], { version: r.version, installed: r.installed, detectedPath: r.path, path: state.harnesses[r.id].path || r.path });
    save();
  });
}
setTimeout(() => pollStreams().catch(() => {}), 15 * 1000);
setInterval(() => pollStreams().catch(() => {}), 3 * 60 * 1000);
setInterval(() => autoPickup().catch((err) => console.error('[auto-pickup]', err.message)), 60 * 1000);

app.listen(PORT, '127.0.0.1', () => {
  console.log(`All My Agents running at http://localhost:${PORT}${DEV ? ' (dev)' : ''}`);
});
