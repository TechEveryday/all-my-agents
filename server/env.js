// Reads and writes the project's .env file. Secrets never leave the server
// unmasked: the client only ever sees whether a secret is set.
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT } from './paths.js';

export const ENV_PATH = path.join(APP_ROOT, '.env');

export const ENV_FIELDS = [
  { key: 'JIRA_BASE_URL', label: 'Jira base URL', placeholder: 'https://your-team.atlassian.net', group: 'Jira' },
  { key: 'JIRA_EMAIL', label: 'Jira email', placeholder: 'you@company.com', group: 'Jira' },
  { key: 'JIRA_USERNAME', label: 'Jira username', placeholder: 'Display name (optional)', group: 'Jira' },
  { key: 'JIRA_API_TOKEN', label: 'Jira API token', secret: true, group: 'Jira' },
  { key: 'GITHUB_USERNAME', label: 'GitHub username', placeholder: 'octocat', group: 'GitHub' },
  { key: 'GITHUB_EMAIL', label: 'GitHub email', placeholder: 'you@users.noreply.github.com', group: 'GitHub' },
  { key: 'GITHUB_TOKEN', label: 'GitHub token', secret: true, group: 'GitHub', hint: 'Optional: falls back to `gh auth token`' },
];

function parse(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

let cache = null;

export function readEnv() {
  if (cache) return cache;
  cache = fs.existsSync(ENV_PATH) ? parse(fs.readFileSync(ENV_PATH, 'utf8')) : {};
  return cache;
}

export function env(key) {
  return readEnv()[key] || process.env[key] || '';
}

/** Merge `updates` into .env, keeping unknown keys and comments intact. */
export function writeEnv(updates) {
  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const lines = existing ? existing.split(/\r?\n/) : ['# All My Agents configuration (managed from Settings > Plugins)'];
  const pending = { ...updates };
  const rewritten = lines.map((line) => {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && m[1] in pending) {
      const v = pending[m[1]];
      delete pending[m[1]];
      return `${m[1]}=${quote(v)}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(pending)) rewritten.push(`${k}=${quote(v)}`);
  while (rewritten.length && rewritten[rewritten.length - 1] === '') rewritten.pop();
  fs.writeFileSync(ENV_PATH, rewritten.join('\n') + '\n', { mode: 0o600 });
  cache = null;
}

function quote(v) {
  const s = String(v ?? '');
  return /[\s#"']/.test(s) ? JSON.stringify(s) : s;
}

/** Client-safe view of the .env values. */
export function publicEnv() {
  const e = readEnv();
  return ENV_FIELDS.map((f) => ({
    ...f,
    value: f.secret ? '' : e[f.key] || '',
    isSet: Boolean(e[f.key]),
  }));
}
