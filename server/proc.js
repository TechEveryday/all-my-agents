// Process helpers. Every long-running child (agents, scripts) is registered so
// the header's stop button can kill them all at once.
import { spawn, execFile } from 'node:child_process';

const running = new Map(); // child -> { streamId }

export function exec(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 20 * 1024 * 1024, timeout: opts.timeout ?? 120000, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err });
    });
  });
}

/** Run a tracked child, streaming each output line to onLine. */
export function runTracked(cmd, args, { cwd, env, streamId, onLine, input } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, detached: true });
    } catch (err) {
      resolve({ code: 127, killed: false, error: err.message });
      return;
    }
    running.set(child, { streamId });
    const pipe = (stream, kind) => {
      let buf = '';
      stream.on('data', (chunk) => {
        buf += chunk.toString();
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          onLine?.(line, kind);
        }
      });
      stream.on('end', () => {
        if (buf) onLine?.(buf, kind);
      });
    };
    pipe(child.stdout, 'stdout');
    pipe(child.stderr, 'stderr');
    if (input) child.stdin.end(input);
    else child.stdin.end();
    child.on('error', (err) => {
      running.delete(child);
      resolve({ code: 127, killed: false, error: err.message });
    });
    child.on('close', (code, signal) => {
      const wasKilled = running.get(child)?.killed || Boolean(signal);
      running.delete(child);
      resolve({ code: code ?? 1, killed: wasKilled });
    });
  });
}

function kill(child) {
  const meta = running.get(child);
  if (meta) meta.killed = true;
  try {
    process.kill(-child.pid, 'SIGTERM'); // whole process group
  } catch {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
}

export function killStream(streamId) {
  let n = 0;
  for (const [child, meta] of running) if (meta.streamId === streamId) { kill(child); n++; }
  return n;
}

export function killAll() {
  let n = 0;
  for (const child of running.keys()) { kill(child); n++; }
  return n;
}

export function isStreamBusy(streamId) {
  for (const meta of running.values()) if (meta.streamId === streamId) return true;
  return false;
}
