// Git helpers: discover local repos, create branches + worktrees.
import fs from 'node:fs';
import path from 'node:path';
import { exec } from './proc.js';
import { APP_ROOT, expandHome } from './paths.js';

export function git(cwd, args, opts) {
  return exec('git', ['-C', cwd, ...args], opts);
}

export async function appCommit() {
  const r = await git(APP_ROOT, ['rev-parse', 'HEAD']);
  const dirty = await git(APP_ROOT, ['status', '--porcelain']);
  const remote = await git(APP_ROOT, ['remote', 'get-url', 'origin']);
  const sha = r.ok ? r.stdout.trim() : '';
  return {
    sha,
    short: sha.slice(0, 7),
    dirty: dirty.ok && dirty.stdout.trim().length > 0,
    url: sha && remote.ok ? toWebUrl(remote.stdout.trim(), `/commit/${sha}`) : null,
  };
}

function toWebUrl(remote, suffix) {
  const m = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
  return m ? `https://github.com/${m[1]}${suffix}` : null;
}

/** owner/name parsed from a repo's origin remote, if it is on GitHub. */
export async function githubSlug(repoPath) {
  const r = await git(repoPath, ['remote', 'get-url', 'origin']);
  if (!r.ok) return null;
  const m = r.stdout.trim().match(/github\.com[:/](.+?)(?:\.git)?$/);
  return m ? m[1] : null;
}

/** Git repositories directly under the repos folder. */
export function listRepos(root) {
  const dir = expandHome(root);
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && fs.existsSync(path.join(dir, d.name, '.git')))
    .map((d) => ({ name: d.name, path: path.join(dir, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function defaultBranch(repoPath) {
  const r = await git(repoPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (r.ok) return r.stdout.trim().replace(/^origin\//, '');
  for (const b of ['main', 'master']) {
    const c = await git(repoPath, ['rev-parse', '--verify', '--quiet', `origin/${b}`]);
    if (c.ok) return b;
  }
  return 'main';
}

export function slugify(text, max = 40) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
}

/**
 * Create `branch` off origin's default branch in a new worktree and publish it.
 * If `existingRemoteBranch` is set, check that branch out instead (used for PR fixes).
 */
export async function createWorktree({ repoPath, worktreesRoot, branch, dirName, existingRemoteBranch, log }) {
  const repoName = path.basename(repoPath);
  const wtPath = path.join(expandHome(worktreesRoot), repoName, dirName);

  log?.(`git fetch origin (${repoName})`);
  const fetch = await git(repoPath, ['fetch', 'origin', '--prune'], { timeout: 180000 });
  if (!fetch.ok) log?.(`fetch failed, continuing with local refs: ${fetch.stderr.trim()}`);

  if (fs.existsSync(wtPath)) {
    log?.(`Worktree already exists at ${wtPath}, reusing it`);
    return { worktreePath: wtPath, base: await defaultBranch(repoPath), reused: true };
  }
  fs.mkdirSync(path.dirname(wtPath), { recursive: true });

  if (existingRemoteBranch) {
    const add = await git(repoPath, ['worktree', 'add', '-B', existingRemoteBranch, wtPath, `origin/${existingRemoteBranch}`]);
    if (!add.ok) throw new Error(`git worktree add failed: ${add.stderr.trim()}`);
    await git(wtPath, ['branch', '--set-upstream-to', `origin/${existingRemoteBranch}`]);
    return { worktreePath: wtPath, base: await defaultBranch(repoPath) };
  }

  const base = await defaultBranch(repoPath);
  const exists = await git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  const addArgs = exists.ok
    ? ['worktree', 'add', wtPath, branch]
    : ['worktree', 'add', '-b', branch, wtPath, `origin/${base}`];
  log?.(`git ${addArgs.join(' ')}`);
  let add = await git(repoPath, addArgs);
  if (!add.ok && !exists.ok) {
    // No origin/<base>? Fall back to the local base branch.
    add = await git(repoPath, ['worktree', 'add', '-b', branch, wtPath, base]);
  }
  if (!add.ok) throw new Error(`git worktree add failed: ${add.stderr.trim()}`);
  // Don't track origin/<base>: pushes must go to the new branch, never the base.
  await git(wtPath, ['branch', '--unset-upstream']);

  log?.(`git push -u origin ${branch}`);
  const push = await git(wtPath, ['push', '-u', 'origin', branch], { timeout: 180000 });
  if (!push.ok) log?.(`Could not create remote branch (continuing locally): ${push.stderr.trim()}`);

  return { worktreePath: wtPath, base, pushed: push.ok };
}

export async function removeWorktree(repoPath, worktreePath) {
  return git(repoPath, ['worktree', 'remove', '--force', worktreePath]);
}
