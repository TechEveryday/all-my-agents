// Agent harnesses (Claude Code, Cursor Agent, Codex): detection, model lists,
// and a headless runner that turns each CLI's JSON stream into activity entries.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec, runTracked } from './proc.js';
import { state } from './store.js';

const HOME = os.homedir();

export const HARNESSES = {
  claude: {
    label: 'Claude Code',
    bins: ['claude'],
    candidates: [`${HOME}/.local/bin/claude`, `${HOME}/.claude/local/claude`, '/opt/homebrew/bin/claude', '/usr/local/bin/claude'],
    models: ['fable', 'opus', 'sonnet', 'haiku', 'claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  cursor: {
    label: 'Cursor Agent',
    bins: ['cursor-agent', 'agent'],
    candidates: [`${HOME}/.local/bin/cursor-agent`, '/opt/homebrew/bin/cursor-agent', '/usr/local/bin/cursor-agent'],
    models: ['auto'],
    efforts: [],
  },
  codex: {
    label: 'Codex',
    bins: ['codex'],
    candidates: ['/opt/homebrew/bin/codex', '/usr/local/bin/codex'],
    models: ['gpt-5-codex', 'gpt-5'],
    efforts: ['low', 'medium', 'high'],
  },
};

async function which(bin) {
  // Use a login shell so nvm/homebrew PATH additions are visible.
  const shell = process.env.SHELL || '/bin/zsh';
  const r = await exec(shell, ['-lc', `command -v ${bin}`], { timeout: 10000 });
  const p = r.stdout.trim().split('\n').pop();
  return r.ok && p && p.startsWith('/') ? p : '';
}

export async function detect(id) {
  const h = HARNESSES[id];
  let found = '';
  for (const bin of h.bins) {
    found = await which(bin);
    if (found) break;
  }
  if (!found) found = h.candidates.find((c) => fs.existsSync(c)) || '';
  let version = '';
  if (found) {
    const v = await exec(found, ['--version'], { timeout: 15000 });
    const line = (v.stdout || v.stderr).trim().split('\n')[0];
    version = v.ok ? line.slice(0, 80) : 'version check failed';
  }
  return { id, path: found, installed: Boolean(found), version };
}

export function binFor(id) {
  return state.harnesses[id]?.path || HARNESSES[id].bins[0];
}

const modelCache = {};
async function cursorModels() {
  if (modelCache.cursor && Date.now() - modelCache.cursor.at < 10 * 60 * 1000) return modelCache.cursor.list;
  const r = await exec(binFor('cursor'), ['models'], { timeout: 20000 });
  const list = r.stdout
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .split('\n')
    .map((l) => l.trim().match(/^([a-z0-9][\w.\-]+)(?:\s+-\s+|\s*$)/i)?.[1])
    .filter((m) => m && !/^(loading|no|available|models?)$/i.test(m));
  modelCache.cursor = { at: Date.now(), list };
  return list;
}

/** Every model the user can pick, as "harness:model" values. */
export async function availableModels() {
  const out = [];
  for (const [id, h] of Object.entries(HARNESSES)) {
    const cfg = state.harnesses[id];
    if (!cfg?.enabled) continue;
    let models = [...h.models];
    if (id === 'cursor') models = [...new Set([...models, ...(await cursorModels().catch(() => []))])];
    models = [...new Set([...models, ...(cfg.customModels || [])])];
    for (const m of models) out.push({ value: `${id}:${m}`, harness: id, harnessLabel: h.label, model: m, efforts: h.efforts });
  }
  return out;
}

export function parseModel(value) {
  const [harness, ...rest] = String(value || state.settings.defaultModel).split(':');
  return HARNESSES[harness] ? { harness, model: rest.join(':') } : { harness: 'claude', model: value };
}

function buildArgs({ harness, model, effort, prompt, sessionId, cwd }) {
  const perm = state.settings.permissionMode || 'auto';
  if (harness === 'claude') {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', perm];
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (sessionId) args.push('--resume', sessionId);
    return args;
  }
  if (harness === 'cursor') {
    const args = ['-p', '--output-format', 'stream-json', '--workspace', cwd];
    if (model && model !== 'auto') args.push('--model', model);
    if (perm === 'bypassPermissions' || perm === 'auto') args.push('--force');
    if (sessionId) args.push('--resume', sessionId);
    args.push(prompt);
    return args;
  }
  // codex
  const args = ['exec'];
  if (sessionId) args.push('resume', sessionId);
  args.push('--json', '--skip-git-repo-check');
  if (model) args.push('--model', model);
  if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
  args.push(perm === 'bypassPermissions' ? '--dangerously-bypass-approvals-and-sandbox' : '--full-auto');
  args.push(prompt);
  return args;
}

function summarizeTool(name, input) {
  if (!input || typeof input !== 'object') return name;
  const detail = input.command || input.file_path || input.path || input.pattern || input.url || input.description || input.skill || '';
  return detail ? `${name}: ${String(detail).slice(0, 200)}` : name;
}

/** Map one JSON line from any harness to zero or more activity entries. */
function interpret(obj, ctx) {
  const out = [];
  const sid = obj.session_id || obj.sessionId || obj.thread_id || obj.chatId;
  if (sid) ctx.sessionId = sid;

  if (obj.type === 'assistant' && obj.message?.content) {
    for (const c of obj.message.content) {
      if (c.type === 'text' && c.text?.trim()) {
        out.push({ kind: 'agent', text: c.text.trim() });
        ctx.lastText = c.text.trim();
      } else if (c.type === 'tool_use') out.push({ kind: 'tool', text: summarizeTool(c.name, c.input) });
    }
  } else if (obj.type === 'tool_call' && obj.subtype === 'started') {
    const [name, call] = Object.entries(obj.tool_call || {})[0] || ['tool', {}];
    out.push({ kind: 'tool', text: summarizeTool(name.replace(/ToolCall$/, ''), call?.args) });
  } else if (obj.type === 'result') {
    ctx.isError = Boolean(obj.is_error) || (obj.subtype && obj.subtype !== 'success');
    const usd = obj.total_cost_usd ?? obj.cost_usd ?? obj.usage?.cost_usd;
    if (usd != null && !Number.isNaN(Number(usd))) ctx.cost = (ctx.cost || 0) + Number(usd);
    if (obj.result) ctx.lastText = String(obj.result);
    const cost = obj.total_cost_usd != null ? ` · $${Number(obj.total_cost_usd).toFixed(2)}` : '';
    const dur = obj.duration_ms ? ` · ${Math.round(obj.duration_ms / 1000)}s` : '';
    out.push({ kind: 'system', text: `${ctx.isError ? 'Agent finished with an error' : 'Agent finished'}${dur}${cost}` });
  } else if (obj.type === 'item.completed' && obj.item) {
    // codex
    if (obj.item.type === 'agent_message' && obj.item.text) {
      out.push({ kind: 'agent', text: obj.item.text });
      ctx.lastText = obj.item.text;
    } else if (obj.item.type === 'command_execution') out.push({ kind: 'tool', text: `Bash: ${obj.item.command}` });
    else if (obj.item.type === 'file_change') out.push({ kind: 'tool', text: `Edit: ${(obj.item.changes || []).map((c) => c.path).join(', ')}` });
  } else if (obj.type === 'turn.failed' || obj.type === 'error') {
    ctx.isError = true;
    out.push({ kind: 'error', text: obj.error?.message || obj.message || 'Agent error' });
  }
  return out;
}

/**
 * Run an agent headlessly in `cwd`.
 * Resolves { ok, sessionId, text, killed }.
 */
export async function runAgent({ modelValue, effort, prompt, cwd, sessionId, streamId, onActivity }) {
  const { harness, model } = parseModel(modelValue);
  const args = buildArgs({ harness, model, effort: HARNESSES[harness].efforts.includes(effort) ? effort : '', prompt, sessionId, cwd });
  const ctx = { sessionId, lastText: '', isError: false, cost: null };
  const stderr = [];
  onActivity({ kind: 'system', text: `Running ${HARNESSES[harness].label}${model ? ` (${model}${effort ? `, ${effort}` : ''})` : ''}${sessionId ? ' · resumed session' : ''}` });

  const res = await runTracked(binFor(harness), args, {
    cwd,
    streamId,
    env: { FORCE_COLOR: '0' },
    onLine: (line, kind) => {
      if (!line.trim()) return;
      if (kind === 'stderr') {
        stderr.push(line);
        return;
      }
      try {
        for (const e of interpret(JSON.parse(line), ctx)) onActivity({ ...e, model: `${harness}:${model}` });
      } catch {
        onActivity({ kind: 'log', text: line.slice(0, 2000) });
      }
    },
  });

  if (res.error) onActivity({ kind: 'error', text: `Could not start ${binFor(harness)}: ${res.error}` });
  if (res.code !== 0 && !res.killed && stderr.length) onActivity({ kind: 'error', text: stderr.slice(-15).join('\n') });
  return { ok: res.code === 0 && !ctx.isError && !res.killed, killed: res.killed, sessionId: ctx.sessionId, text: ctx.lastText, harness, cost: ctx.cost };
}

export function harnessSummary() {
  return Object.entries(HARNESSES).map(([id, h]) => ({ id, label: h.label, efforts: h.efforts, ...state.harnesses[id] }));
}

export function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return path.isAbsolute(p);
  } catch {
    return false;
  }
}
