// Persistent app state (settings, sources, workflow, streams) in data/state.json.
// Per-stream agent activity is appended to data/activity/<streamId>.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DATA_DIR, ACTIVITY_DIR } from './paths.js';
import { bus } from './events.js';

const STATE_PATH = path.join(DATA_DIR, 'state.json');

export const DEFAULT_STEPS = [
  { id: 'plan', title: 'Plan', description: 'Create a plan to implement the claimed ticket.', runs: 'skill', model: 'claude:opus', effort: 'high' },
  { id: 'implement', title: 'Implement', description: 'Execute the plan and commit the work.', runs: 'skill', model: 'claude:opus', effort: 'high' },
  { id: 'review', title: 'Review', description: 'Local review of the branch by both Claude and Cursor.', runs: 'skill', model: 'claude:opus', model2: 'cursor:auto', effort: 'high' },
  { id: 'fix', title: 'Fix findings', description: 'Validate each review finding, then fix the ones that hold up.', runs: 'skill', model: 'claude:opus', effort: 'medium' },
  { id: 'validate', title: 'Validation', description: 'Run the tests and make sure the branch builds as is.', runs: 'skill', model: 'claude:sonnet', effort: 'medium' },
  { id: 'create-pr', title: 'Create PR', description: 'Push the branch and open a pull request.', runs: 'script', script: 'scripts/create-pr.sh', model: 'claude:sonnet', effort: 'low' },
  { id: 'watch-pr', title: 'Watch PR', description: 'Poll the PR until every check is green and it can be merged.', runs: 'script', script: 'scripts/watch-pr.sh', model: 'claude:sonnet', effort: 'low' },
  { id: 'pr-feedback', title: 'Resolve PR Feedback', description: 'Address feedback from pipeline jobs, bots and humans.', runs: 'skill', model: 'claude:opus', effort: 'high' },
].map((s) => ({ skill: '', script: '', model2: '', skip: false, ...s }));

function defaults() {
  return {
    settings: {
      reposRoot: path.join(os.homedir(), 'repos'),
      worktreesRoot: path.join(os.homedir(), '.all-my-agents', 'worktrees'),
      branchPrefix: '',
      autoPickup: false,
      deleteWorktreeOnDone: true,
      notifyAttention: true,
      permissionMode: 'auto',
      mergeMethod: 'squash',
      maxFeedbackLoops: 3,
      defaultModel: 'claude:opus',
    },
    harnesses: {
      claude: { enabled: true, path: '', customModels: [] },
      cursor: { enabled: true, path: '', customModels: [] },
      codex: { enabled: false, path: '', customModels: [] },
    },
    skills: { enabled: {}, custom: [] },
    sources: [],
    otherTodos: [],
    launchCommands: {}, // repo folder name -> command used by Launch app
    otherSeq: 0,
    tabNames: { all: 'All', other: 'Other' },
    workflow: { steps: DEFAULT_STEPS, commit: { runs: 'skill', skill: '', script: '' } },
    streams: [],
  };
}

function load() {
  const base = defaults();
  if (!fs.existsSync(STATE_PATH)) return base;
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return {
      ...base,
      ...saved,
      settings: { ...base.settings, ...saved.settings },
      harnesses: { ...base.harnesses, ...saved.harnesses },
      skills: { ...base.skills, ...saved.skills },
      tabNames: { ...base.tabNames, ...saved.tabNames },
      workflow: {
        ...base.workflow,
        ...saved.workflow,
        // Keep saved step order/config, but make sure every default step exists.
        steps: DEFAULT_STEPS.map((d) => ({ ...d, ...(saved.workflow?.steps || []).find((s) => s.id === d.id) })),
      },
    };
  } catch (err) {
    console.error('[store] could not read state.json, starting fresh:', err.message);
    return base;
  }
}

export const state = load();

let timer = null;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }, 150);
}

// ---- streams -------------------------------------------------------------

export function getStream(id) {
  return state.streams.find((s) => s.id === id);
}

export function updateStream(id, patch) {
  const s = getStream(id);
  if (!s) return null;
  Object.assign(s, patch, { updatedAt: new Date().toISOString() });
  save();
  bus.emit('stream', s);
  return s;
}

export function appendActivity(streamId, entry) {
  const full = { ts: new Date().toISOString(), ...entry };
  fs.mkdirSync(ACTIVITY_DIR, { recursive: true });
  fs.appendFileSync(path.join(ACTIVITY_DIR, `${streamId}.jsonl`), JSON.stringify(full) + '\n');
  bus.emit('activity', { streamId, entry: full });
  return full;
}

export function readActivity(streamId) {
  const file = path.join(ACTIVITY_DIR, `${streamId}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}
