// "Launch app": run a repo's dev server from a stream's worktree so you can try
// the branch locally. App processes are tracked apart from agents, so stopping
// agents never takes the app down (and a running app never blocks prompts).
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { state, save, getStream, updateStream, appendActivity } from './store.js';

const apps = new Map(); // streamId -> child
const MAX_LOGGED_LINES = 80;

function has(dir, file) {
  return fs.existsSync(path.join(dir, file));
}

/** Best guess at how to run this project, including installing deps in a fresh worktree. */
export function detectLaunchCommand(dir) {
  if (has(dir, 'package.json')) {
    let scripts = {};
    try { scripts = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts || {}; } catch { /* ignore */ }
    const pm = has(dir, 'pnpm-lock.yaml') ? 'pnpm' : has(dir, 'yarn.lock') ? 'yarn' : has(dir, 'bun.lockb') || has(dir, 'bun.lock') ? 'bun' : 'npm';
    const script = ['dev', 'start', 'serve'].find((s) => scripts[s]);
    const run = script ? (pm === 'npm' ? (script === 'start' ? 'npm start' : `npm run ${script}`) : `${pm} ${script}`) : null;
    const install = has(dir, 'node_modules') ? '' : `${pm} install && `;
    if (run) return install + run;
  }
  if (has(dir, 'docker-compose.yml') || has(dir, 'compose.yaml') || has(dir, 'compose.yml')) return 'docker compose up --build';
  if (has(dir, 'manage.py')) return 'python manage.py runserver';
  if (has(dir, 'bin/rails')) return 'bin/rails server';
  if (has(dir, 'Cargo.toml')) return 'cargo run';
  if (has(dir, 'go.mod')) return 'go run .';
  if (has(dir, 'Makefile')) {
    const mk = fs.readFileSync(path.join(dir, 'Makefile'), 'utf8');
    const target = ['dev', 'run', 'serve', 'start'].find((t) => new RegExp(`^${t}:`, 'm').test(mk));
    if (target) return `make ${target}`;
  }
  const sln = fs.readdirSync(dir).find((f) => f.endsWith('.csproj') || f.endsWith('.sln'));
  if (sln) return 'dotnet run';
  return '';
}

export function suggestedCommand(s) {
  const saved = state.launchCommands?.[s.repoName];
  return { command: saved || detectLaunchCommand(s.worktreePath), saved: Boolean(saved) };
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', () => resolve(0));
  });
}

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?[^\s'"]*/i;

export async function launchApp(streamId, command, { remember } = {}) {
  const s = getStream(streamId);
  if (!s?.worktreePath || s.worktreeRemoved || !fs.existsSync(s.worktreePath)) throw new Error('This stream has no worktree to run.');
  if (!command?.trim()) throw new Error('Enter a command to launch the app.');
  if (apps.has(streamId)) stopApp(streamId);
  if (remember) {
    state.launchCommands = { ...state.launchCommands, [s.repoName]: command.trim() };
    save();
  }

  const port = await freePort();
  const log = (text, kind = 'log') => appendActivity(streamId, { kind, step: 'App', text });
  log(`$ ${command}  (in ${s.worktreePath}, PORT=${port})`, 'step');
  const shell = process.env.SHELL || '/bin/zsh';
  const child = spawn(shell, ['-lc', command], {
    cwd: s.worktreePath,
    env: { ...process.env, PORT: String(port), FORCE_COLOR: '0', BROWSER: 'none' },
    detached: true,
  });
  apps.set(streamId, child);
  updateStream(streamId, { app: { running: true, command, port, url: null, pid: child.pid, startedAt: new Date().toISOString() } });

  let lines = 0;
  const onData = (chunk, kind) => {
    for (const raw of chunk.toString().split('\n')) {
      const line = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trimEnd();
      if (!line) continue;
      const cur = getStream(streamId)?.app;
      const m = !cur?.url && line.match(URL_RE);
      if (m) {
        const url = m[0].replace('0.0.0.0', 'localhost').replace(/[).,]+$/, '');
        updateStream(streamId, { app: { ...cur, url } });
        log(`App is up at ${url}`, 'system');
      }
      lines++;
      if (lines <= MAX_LOGGED_LINES) log(line, kind === 'stderr' ? 'log-err' : 'log');
      else if (lines === MAX_LOGGED_LINES + 1) log('…further app output is hidden', 'system');
    }
  };
  child.stdout.on('data', (c) => onData(c, 'stdout'));
  child.stderr.on('data', (c) => onData(c, 'stderr'));
  child.on('exit', (code, signal) => {
    apps.delete(streamId);
    const cur = getStream(streamId);
    if (cur) updateStream(streamId, { app: { ...cur.app, running: false } });
    log(signal ? 'App stopped' : `App exited with code ${code}`, code && !signal ? 'error' : 'system');
  });
  child.on('error', (err) => log(`Could not start app: ${err.message}`, 'error'));
  return getStream(streamId).app;
}

export function stopApp(streamId) {
  const child = apps.get(streamId);
  if (!child) {
    const s = getStream(streamId);
    if (s?.app?.running) updateStream(streamId, { app: { ...s.app, running: false } });
    return false;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
  return true;
}

export function stopAllApps() {
  for (const id of [...apps.keys()]) stopApp(id);
}

/** After a server restart no app processes are ours any more. */
export function resetApps() {
  for (const s of state.streams) if (s.app?.running) updateStream(s.id, { app: { ...s.app, running: false } });
}
