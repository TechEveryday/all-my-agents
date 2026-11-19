import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { toast } from '../App.jsx';
import { AppleIcon, CheckIcon, CopyIcon, FolderOpenIcon, TerminalIcon, WindowsIcon } from './Icons.jsx';

let platformPromise = null;
export function usePlatform() {
  const [platform, setPlatform] = useState(null);
  useEffect(() => {
    platformPromise ||= api('/meta').then((m) => m.platform).catch(() => null);
    platformPromise.then(setPlatform);
  }, []);
  return platform;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for browsers that block the async clipboard API.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

/** Split any absolute path (macOS/Linux, Windows, Git Bash, WSL) into drive + segments. */
function parse(p) {
  let m = p.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (m) return { drive: m[1].toUpperCase(), segs: m[2].split(/[\\/]+/).filter(Boolean) };
  m = p.match(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/) || p.match(/^\/([a-zA-Z])(?:\/(.*))?$/);
  if (m) return { drive: m[1].toUpperCase(), segs: (m[2] || '').split('/').filter(Boolean) };
  return { drive: null, segs: p.split(/[\\/]+/).filter(Boolean) };
}

const posixQuote = (s) => (/^[\w./~:@%+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
const winQuote = (s) => (/[\s&()^%!;,'`]/.test(s) ? `"${s}"` : s);

/** style: 'mac' (POSIX / Terminal), 'bash' (Git Bash), 'windows' (cmd / PowerShell). */
export function formatPath(path, style) {
  const { drive, segs } = parse(path);
  if (style === 'windows') return winQuote(drive ? `${drive}:\\${segs.join('\\')}` : `\\${segs.join('\\')}`);
  if (style === 'bash') return posixQuote(drive ? `/${drive.toLowerCase()}/${segs.join('/')}` : `/${segs.join('/')}`);
  return posixQuote(drive ? `${drive}:/${segs.join('/')}` : `/${segs.join('/')}`);
}

const FILE_MANAGER = { darwin: 'Finder', win32: 'File Explorer' };

function IconButton({ title, onClick, children }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="tool-btn"
      title={title}
      aria-label={title.split('\n')[0]}
      onClick={async (e) => {
        e.stopPropagation();
        if ((await onClick()) !== false) {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        }
      }}
    >
      {done ? <CheckIcon width={13} height={13} /> : children}
    </button>
  );
}

export function CopyButton({ text, what }) {
  return (
    <IconButton
      title={`Copy ${what}`}
      onClick={async () => {
        await copyText(text);
        toast(`Copied ${what}`);
      }}
    >
      <CopyIcon />
    </IconButton>
  );
}

/** Copy the worktree path for macOS / Git Bash / Windows, or open it in the OS file manager. */
export function WorktreeTools({ stream }) {
  const platform = usePlatform();
  const p = stream.worktreePath;
  if (!p) return null;
  if (stream.worktreeRemoved) return <span className="muted xsmall">worktree deleted</span>;
  const copy = (style, label) => async () => {
    await copyText(formatPath(p, style));
    toast(`Copied ${label} path`);
  };
  return (
    <span className="tools" onClick={(e) => e.stopPropagation()}>
      <IconButton title={`Copy path for macOS Terminal\n${formatPath(p, 'mac')}`} onClick={copy('mac', 'macOS')}>
        <AppleIcon width={13} height={13} />
      </IconButton>
      <IconButton title={`Copy path for Git Bash\n${formatPath(p, 'bash')}`} onClick={copy('bash', 'Git Bash')}>
        <TerminalIcon width={13} height={13} />
      </IconButton>
      <IconButton title={`Copy path for Windows cmd / PowerShell\n${formatPath(p, 'windows')}`} onClick={copy('windows', 'Windows')}>
        <WindowsIcon width={12} height={12} />
      </IconButton>
      <IconButton
        title={`Open worktree in ${FILE_MANAGER[platform] || 'file manager'}\n${p}`}
        onClick={() =>
          api(`/streams/${stream.id}/open`, { method: 'POST', body: { target: 'folder' } }).catch((err) => {
            toast(err.message, 'error');
            return false;
          })
        }
      >
        <FolderOpenIcon width={13} height={13} />
      </IconButton>
    </span>
  );
}

export function formatCost(stream) {
  const usd = stream.costUsd || 0;
  const unknown = stream.costUnknownRuns || 0;
  if (!usd && !unknown) return { text: '$0.00', title: 'No agent runs yet' };
  const lines = Object.entries(stream.costByStep || {}).map(([step, c]) => `${step}: $${c.toFixed(2)}`);
  if (unknown) lines.push(`${unknown} run(s) didn't report a cost (Cursor/Codex, or stopped early) — total may be higher`);
  return { text: `$${usd.toFixed(2)}${unknown ? '+' : ''}`, title: `Total agent cost for this ticket\n${lines.join('\n')}` };
}
