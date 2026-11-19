// The Workflow engine: walks a stream through Plan → Implement → Review →
// Fix findings → Validation → Create PR → Watch PR ⇄ Resolve PR Feedback.
import fs from 'node:fs';
import path from 'node:path';
import { state, getStream, updateStream, appendActivity } from './store.js';
import { runAgent, parseModel } from './harness.js';
import { exec, runTracked, killStream, isStreamBusy } from './proc.js';
import { APP_ROOT, expandHome } from './paths.js';
import { git, removeWorktree } from './git.js';
import { bus } from './events.js';
import * as github from './github.js';
import * as jira from './jira.js';
import { stopApp } from './launch.js';
import { discoverSkills } from './skills.js';

export const WORK_DIR = '.all-my-agents'; // per-worktree scratch dir (git-excluded)
const active = new Set();
const finishLater = new Set();

export const isActive = (id) => active.has(id) || isStreamBusy(id);

function log(streamId, entry) {
  return appendActivity(streamId, entry);
}

function stepIdx(id) {
  return state.workflow.steps.findIndex((s) => s.id === id);
}

function context(s) {
  const lines = [
    `Ticket ${s.ticket.key}: ${s.ticket.summary}`,
    s.ticket.url ? `Ticket link: ${s.ticket.url}` : null,
    s.ticket.description ? `Details: ${s.ticket.description}` : null,
    `You are working in a git worktree at ${s.worktreePath} on branch \`${s.branch}\` (base branch: \`${s.base}\`).`,
    s.ghRepo ? `GitHub repository: ${s.ghRepo}` : null,
    s.pr ? `Pull request: ${s.pr.url}` : null,
    `Keep notes and scratch files in ./${WORK_DIR}/ (it is git-ignored).`,
  ];
  return lines.filter(Boolean).join('\n');
}

function commitInstruction(s) {
  const c = state.workflow.commit || {};
  if (c.runs === 'skill' && c.skill) return `When you commit, use the /${c.skill} skill.`;
  if (c.runs === 'script' && c.script) return `When you commit, stage your changes and run \`${resolveScript(c.script, s)}\` to create the commit.`;
  return `Commit your changes with clear, conventional commit messages that reference ${s.ticket.key}. Never commit files in ./${WORK_DIR}/.`;
}

const DEFAULT_PROMPTS = {
  plan: (s) => `Create an implementation plan for this ticket. Read the ticket${s.ticket.type === 'github' ? ' (`gh issue view` works)' : ''}, explore the relevant code, and write a concise step-by-step plan to ./${WORK_DIR}/PLAN.md: files to change, approach, tests to add, and risks. Do not change any code yet. Finish with a short summary of the plan.`,
  implement: (s) => `Implement the plan in ./${WORK_DIR}/PLAN.md. Keep changes focused on the ticket, add or update tests, and follow the repo's conventions. ${commitInstruction(s)}`,
  review: (s, harness) => `Review the changes on this branch against origin/${s.base} (\`git diff origin/${s.base}...HEAD\`). Look for bugs, missing tests, security issues and risky changes. Write your findings as a numbered list (file:line, severity, explanation) to ./${WORK_DIR}/review-${harness}.md. Do not modify any code.`,
  fix: (s) => `Review findings for this branch are in ./${WORK_DIR}/review-*.md. For each finding, first decide whether it actually holds up by reading the code — reviewers can be wrong. Fix the findings that are valid, and record every finding with its verdict (fixed / dismissed + why) in ./${WORK_DIR}/FIXES.md. ${commitInstruction(s)}`,
  validate: (s) => `Validate this branch: find the project's test, lint, typecheck and build commands (package.json, Makefile, CI config) and run them. Fix failures caused by this branch. ${commitInstruction(s)} End your reply with exactly one line: \`VALIDATION: PASS\` or \`VALIDATION: FAIL\`.`,
  'create-pr': (s) => `Push branch \`${s.branch}\` and open a pull request against \`${s.base}\` with \`gh pr create\`. Title: "${s.ticket.key}: ${s.ticket.summary}". Summarize the change and link the ticket in the body.`,
  'watch-pr': () => `Check this branch's pull request with \`gh pr checks --watch\` and \`gh pr view --json mergeable,mergeStateStatus,reviewDecision\`. End your reply with exactly one line: \`PR: GREEN\` if every check passed and it can be merged, otherwise \`PR: NOT READY\` and why.`,
  'pr-feedback': (s) => `Pull request ${s.pr?.url || 'for this branch'} needs attention. Gather all feedback: failing checks (\`gh pr checks\`, \`gh run view <id> --log-failed\`), review comments and bot comments (\`gh pr view --comments\`, \`gh api repos/${s.ghRepo || '{owner}/{repo}'}/pulls/${s.pr?.number || '<number>'}/comments\`). Validate each piece of feedback, address the valid ones, and explain any you decline. ${commitInstruction(s)} Then push the branch.`,
};

export function resolveScript(cmd, s) {
  const [first, ...rest] = cmd.trim().split(/\s+/);
  const expanded = expandHome(first);
  if (path.isAbsolute(expanded)) return [expanded, ...rest].join(' ');
  if (s?.worktreePath && fs.existsSync(path.join(s.worktreePath, expanded))) return cmd;
  if (fs.existsSync(path.join(APP_ROOT, expanded))) return [path.join(APP_ROOT, expanded), ...rest].join(' ');
  return cmd;
}

function scriptEnv(s) {
  return {
    AMA_TICKET_KEY: s.ticket.key,
    AMA_TICKET_SUMMARY: s.ticket.summary,
    AMA_TICKET_URL: s.ticket.url || '',
    AMA_BRANCH: s.branch,
    AMA_BASE: s.base,
    AMA_WORKTREE: s.worktreePath,
    AMA_REPO_PATH: s.repoPath,
    AMA_GH_REPO: s.ghRepo || '',
    AMA_PR_NUMBER: s.pr?.number ? String(s.pr.number) : '',
    AMA_PR_URL: s.pr?.url || '',
    AMA_PR_TITLE: `${s.ticket.key}: ${s.ticket.summary}`,
  };
}

async function runScript(s, cmd, stepTitle) {
  const resolved = resolveScript(cmd, s);
  log(s.id, { kind: 'system', step: stepTitle, text: `$ ${resolved}` });
  const shell = process.env.SHELL || '/bin/zsh';
  const tail = [];
  const res = await runTracked(shell, ['-lc', resolved], {
    cwd: s.worktreePath,
    streamId: s.id,
    env: scriptEnv(s),
    onLine: (line, kind) => {
      if (!line.trim()) return;
      tail.push(line);
      if (tail.length > 50) tail.shift();
      log(s.id, { kind: kind === 'stderr' ? 'log-err' : 'log', step: stepTitle, text: line.slice(0, 2000) });
    },
  });
  if (res.error) log(s.id, { kind: 'error', step: stepTitle, text: res.error });
  log(s.id, { kind: res.code === 0 ? 'system' : 'error', step: stepTitle, text: `exit ${res.code}${res.killed ? ' (stopped)' : ''}` });
  return { ok: res.code === 0 && !res.killed, killed: res.killed, code: res.code, text: tail.join('\n') };
}

function skillPrompt(skillName, s, step, harness) {
  const skill = discoverSkills().find((k) => k.name === skillName);
  const ctx = context(s);
  if (harness === 'claude') return `/${skillName} ${s.ticket.key}\n\n${ctx}\n\nStep: ${step.title} — ${step.description}`;
  const where = skill?.file ? ` (instructions: ${skill.file})` : '';
  return `Use the "${skillName}" skill${where} for this step.\n\n${ctx}\n\nStep: ${step.title} — ${step.description}`;
}

async function runAgentStep(s, step, modelValue, promptBuilder) {
  const { harness } = parseModel(modelValue);
  const prompt = step.runs === 'skill' && step.skill ? skillPrompt(step.skill, s, step, harness) : `${context(s)}\n\n${promptBuilder(s, harness)}`;
  log(s.id, { kind: 'prompt', step: step.title, model: modelValue, text: prompt });
  const sessionKey = harness;
  const result = await runAgent({
    modelValue,
    effort: step.effort,
    prompt,
    cwd: s.worktreePath,
    // Review runs in a fresh session so reviewers aren't biased by the implementer.
    sessionId: step.id === 'review' ? undefined : s.sessions?.[sessionKey],
    streamId: s.id,
    onActivity: (e) => log(s.id, { ...e, step: step.title }),
  });
  addCost(s.id, step.title, result.cost);
  if (result.sessionId && step.id !== 'review') {
    updateStream(s.id, { sessions: { ...getStream(s.id).sessions, [sessionKey]: result.sessionId } });
  }
  return result;
}

async function executeStep(s, step) {
  if (step.runs === 'script' && step.script) return runScript(s, step.script, step.title);

  const builder = DEFAULT_PROMPTS[step.id] || (() => step.description);
  if (step.id === 'review' && step.model2) {
    const results = await Promise.all([step.model, step.model2].filter(Boolean).map((m) => runAgentStep(s, step, m, builder)));
    return { ok: results.some((r) => r.ok), killed: results.some((r) => r.killed) };
  }
  const result = await runAgentStep(s, step, step.model || state.settings.defaultModel, builder);
  if (step.id === 'validate' && /VALIDATION:\s*FAIL/i.test(result.text || '')) return { ...result, ok: false };
  if (step.id === 'watch-pr' && result.ok) return { ...result, ok: /PR:\s*GREEN/i.test(result.text || '') };
  return result;
}

async function detectPr(s) {
  const v = await exec('gh', ['pr', 'view', s.branch, '--json', 'number,url'], { cwd: s.worktreePath });
  if (!v.ok) return null;
  try { return JSON.parse(v.stdout); } catch { return null; }
}

function notify(s, text) {
  bus.emit('notice', { streamId: s.id, title: `${s.ticket.key} needs attention`, text });
}

/** Drive a stream forward from its current step until it waits, fails or is stopped. */
export async function runWorkflow(streamId) {
  if (active.has(streamId)) return;
  active.add(streamId);
  updateStream(streamId, { stopRequested: false });
  try {
    for (;;) {
      const s = getStream(streamId);
      if (!s || s.stopRequested) break;
      const steps = state.workflow.steps;

      if (s.stepIndex >= steps.length) {
        if (s.pr) {
          updateStream(streamId, { status: 'In Code review', stage: 'Watch PR', statusDetail: '' });
          log(streamId, { kind: 'step', text: 'Workflow complete → In Code review' });
        } else {
          log(streamId, { kind: 'step', text: 'Workflow complete → Done' });
          finishLater.add(streamId);
        }
        break;
      }

      const step = steps[s.stepIndex];
      const watchSkipped = steps[stepIdx('watch-pr')]?.skip;
      if (step.skip || s.skipSteps?.includes(step.id) || (step.id === 'pr-feedback' && watchSkipped && !s.forceFeedback)) {
        log(streamId, { kind: 'step', step: step.title, text: `Skipped ${step.title}` });
        updateStream(streamId, { stepIndex: s.stepIndex + 1 });
        continue;
      }

      updateStream(streamId, { stage: step.title, status: 'Running', statusDetail: '' });
      log(streamId, { kind: 'step', step: step.title, text: `▶ ${step.title}` });

      let result;
      try {
        result = await executeStep(getStream(streamId), step);
      } catch (err) {
        result = { ok: false, error: err.message };
        log(streamId, { kind: 'error', step: step.title, text: err.message });
      }

      const now = getStream(streamId);
      if (!now) break;
      if (result.killed || now.stopRequested) {
        updateStream(streamId, { status: 'Stopped', statusDetail: `Stopped during ${step.title}` });
        log(streamId, { kind: 'step', step: step.title, text: `■ Stopped during ${step.title}` });
        break;
      }

      if (step.id === 'create-pr' && result.ok) {
        const pr = await detectPr(now);
        if (pr) {
          updateStream(streamId, { pr });
          log(streamId, { kind: 'step', step: step.title, text: `Pull request #${pr.number}: ${pr.url}` });
        }
      }

      if (step.id === 'watch-pr') {
        if (result.ok) {
          updateStream(streamId, { status: 'In Code review', statusDetail: 'Checks green, waiting on review/merge', feedbackLoops: 0 });
          log(streamId, { kind: 'step', step: step.title, text: '✓ PR is green and mergeable → In Code review' });
          break;
        }
        const fb = steps[stepIdx('pr-feedback')];
        const loops = now.feedbackLoops || 0;
        if (!fb.skip && loops < (state.settings.maxFeedbackLoops || 3)) {
          updateStream(streamId, { feedbackLoops: loops + 1, stepIndex: stepIdx('pr-feedback') });
          log(streamId, { kind: 'step', step: step.title, text: `PR not ready → Resolve PR Feedback (attempt ${loops + 1})` });
          continue;
        }
        updateStream(streamId, { status: 'Needs attention', statusDetail: 'PR checks/feedback still failing' });
        notify(now, 'PR checks or feedback are still failing.');
        break;
      }

      if (!result.ok) {
        updateStream(streamId, { status: 'Needs attention', statusDetail: `${step.title} failed` });
        log(streamId, { kind: 'step', step: step.title, text: `✗ ${step.title} failed — retry, skip, or prompt the agent` });
        notify(now, `${step.title} failed.`);
        break;
      }

      log(streamId, { kind: 'step', step: step.title, text: `✓ ${step.title} done` });
      if (step.id === 'pr-feedback') {
        updateStream(streamId, { stepIndex: stepIdx('watch-pr'), forceFeedback: false });
        if (steps[stepIdx('watch-pr')].skip) {
          updateStream(streamId, { status: 'In Code review', statusDetail: 'Feedback addressed', stepIndex: steps.length });
          break;
        }
        continue;
      }
      updateStream(streamId, { stepIndex: now.stepIndex + 1 });
    }
  } finally {
    active.delete(streamId);
    const s = getStream(streamId);
    if (finishLater.delete(streamId)) await finishStream(streamId, 'Done');
    else if (s?.status === 'Running') updateStream(streamId, { status: 'Stopped' });
  }
}

export function stopStream(streamId) {
  updateStream(streamId, { stopRequested: true });
  return killStream(streamId);
}

/** Free-form prompt from the Agent Activity drawer. */
export async function promptStream(streamId, text, modelValue) {
  const s = getStream(streamId);
  if (!s) throw new Error('Unknown stream');
  if (isActive(streamId)) throw new Error('An agent is already running for this stream. Stop it first or wait.');
  const { harness } = parseModel(modelValue);
  const prev = { status: s.status, statusDetail: s.statusDetail };
  updateStream(streamId, { status: 'Running', statusDetail: 'Responding to your prompt', model: modelValue });
  log(streamId, { kind: 'user', model: modelValue, text });
  active.add(streamId);
  try {
    const result = await runAgent({
      modelValue,
      effort: s.effort || undefined,
      prompt: s.sessions?.[harness] ? text : `${context(s)}\n\n${text}`,
      cwd: s.worktreePath,
      sessionId: s.sessions?.[harness],
      streamId,
      onActivity: (e) => log(streamId, { ...e, step: 'Chat' }),
    });
    addCost(streamId, 'Chat', result.cost);
    if (result.sessionId) updateStream(streamId, { sessions: { ...getStream(streamId).sessions, [harness]: result.sessionId } });
  } finally {
    active.delete(streamId);
    updateStream(streamId, prev.status === 'Running' ? { status: 'Stopped' } : prev);
  }
}

/** Ensure ./.all-my-agents is ignored in every worktree of this repo. */
export async function excludeWorkDir(worktreePath) {
  const r = await git(worktreePath, ['rev-parse', '--git-common-dir']);
  if (!r.ok) return;
  const common = path.resolve(worktreePath, r.stdout.trim());
  const file = path.join(common, 'info', 'exclude');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (!cur.split('\n').includes(`${WORK_DIR}/`)) fs.appendFileSync(file, `${cur.endsWith('\n') || !cur ? '' : '\n'}${WORK_DIR}/\n`);
  fs.mkdirSync(path.join(worktreePath, WORK_DIR), { recursive: true });
}

const round = (n) => Math.round(n * 10000) / 10000;

/** Add one agent run's cost to the stream's running total. `cost` is null when the harness doesn't report it. */
function addCost(streamId, stepTitle, cost) {
  const s = getStream(streamId);
  if (!s) return;
  if (cost == null) {
    updateStream(streamId, { costUnknownRuns: (s.costUnknownRuns || 0) + 1 });
    return;
  }
  const byStep = { ...(s.costByStep || {}) };
  byStep[stepTitle] = round((byStep[stepTitle] || 0) + cost);
  updateStream(streamId, { costUsd: round((s.costUsd || 0) + cost), costByStep: byStep });
}

export const FINISHED = ['Merged', 'Closed', 'Done'];

/**
 * Delete a stream's worktree, unless it holds work that exists nowhere else
 * (uncommitted changes, or commits that were never pushed).
 */
export async function cleanupWorktree(streamId, { merged = false } = {}) {
  const s = getStream(streamId);
  if (!s?.worktreePath || s.worktreeRemoved) return { ok: true, skipped: true };
  if (!fs.existsSync(s.worktreePath)) {
    updateStream(streamId, { worktreeRemoved: true });
    return { ok: true };
  }
  const dirty = await git(s.worktreePath, ['status', '--porcelain']);
  const unpushed = await git(s.worktreePath, ['rev-list', '--count', 'HEAD', '--not', '--remotes']);
  const reasons = [];
  if (dirty.ok && dirty.stdout.trim()) reasons.push('uncommitted changes');
  // After a merge the commits live in the base branch, even if the PR branch was deleted remotely.
  if (!merged && unpushed.ok && Number(unpushed.stdout.trim()) > 0) reasons.push(`${unpushed.stdout.trim()} unpushed commit(s)`);
  if (reasons.length) {
    const text = `Kept worktree ${s.worktreePath}: it has ${reasons.join(' and ')}. Push or discard them, then use Remove worktree.`;
    log(streamId, { kind: 'error', text });
    updateStream(streamId, { statusDetail: 'Worktree kept: unsaved work' });
    return { ok: false, error: text };
  }
  const r = await removeWorktree(s.repoPath, s.worktreePath);
  await git(s.repoPath, ['worktree', 'prune']);
  if (!r.ok) {
    log(streamId, { kind: 'error', text: `Could not remove worktree: ${r.stderr.trim()}` });
    return { ok: false, error: r.stderr.trim() };
  }
  updateStream(streamId, { worktreeRemoved: true, statusDetail: '' });
  log(streamId, { kind: 'system', text: `Deleted worktree ${s.worktreePath} (branch ${s.branch} is kept)` });
  return { ok: true };
}

/** Move a stream to a finished status, stopping its agents and deleting its worktree. */
export async function finishStream(streamId, status, note) {
  const s = getStream(streamId);
  if (!s) return;
  if (isActive(streamId)) {
    stopStream(streamId);
    await new Promise((r) => setTimeout(r, 1500));
  }
  stopApp(streamId);
  updateStream(streamId, { status, stage: 'Complete', statusDetail: '' });
  log(streamId, { kind: 'step', text: note || `→ ${status}` });
  if (s.ticket.type === 'other') {
    const t = state.otherTodos.find((x) => x.id === s.ticket.id);
    if (t) t.done = true;
  }
  if (status !== 'Closed' && state.settings.deleteWorktreeOnDone !== false) await cleanupWorktree(streamId, { merged: status === 'Merged' });
}

async function ticketDone(s) {
  if (s.ticket.type === 'jira') return jira.isDone(s.ticket.key);
  if (s.ticket.type === 'github' && s.ticket.issueRepo && s.ticket.number) return github.isIssueClosed(s.ticket.issueRepo, s.ticket.number);
  return false;
}

/** Background: notice merged PRs and tickets marked done elsewhere. */
export async function pollStreams() {
  for (const s of state.streams.filter((x) => !FINISHED.includes(x.status) && x.worktreePath)) {
    try {
      if (s.pr && s.ghRepo) {
        const pr = await github.getPullRequest(s.ghRepo, s.pr.number);
        if (pr.merged) {
          await finishStream(s.id, 'Merged', '✓ PR merged');
          continue;
        }
        if (pr.state === 'CLOSED') {
          await finishStream(s.id, 'Closed', 'PR closed without merging');
          continue;
        }
      }
      if (await ticketDone(s)) await finishStream(s.id, 'Done', `✓ ${s.ticket.key} was marked done`);
    } catch { /* offline or no auth; try again later */ }
  }
}

/** Stop a stream's agents and wait (up to 10s) until nothing is running for it. */
async function stopAndWait(streamId) {
  if (!isActive(streamId)) return;
  stopStream(streamId);
  for (let i = 0; i < 40 && isActive(streamId); i++) await new Promise((r) => setTimeout(r, 250));
}

/**
 * Jump to `stepId` and run from there — for work that happened outside this
 * tool. Anything running is stopped first.
 */
export async function advanceTo(streamId, stepId) {
  const s = getStream(streamId);
  if (!s) throw new Error('Unknown stream');
  if (!s.worktreePath || s.worktreeRemoved) throw new Error('This stream has no worktree');
  const idx = stepIdx(stepId);
  if (idx < 0) throw new Error(`Unknown step ${stepId}`);
  await stopAndWait(streamId);
  const steps = state.workflow.steps;
  const patch = { stepIndex: idx, feedbackLoops: 0, forceFeedback: stepId === 'pr-feedback', statusDetail: '' };
  // Advancing past Create PR: pick up a PR that was opened by hand.
  if (!s.pr && idx > stepIdx('create-pr')) {
    const pr = await detectPr(s);
    if (pr) patch.pr = pr;
  }
  updateStream(streamId, patch);
  log(streamId, { kind: 'step', text: `⏭ Advanced to ${steps[idx].title} (manually)` });
  runWorkflow(streamId);
}

/** Skip (or un-skip) one step for this stream only. Skipping the running step moves on. */
export async function setStepSkipped(streamId, stepId, skipped) {
  const s = getStream(streamId);
  if (!s) throw new Error('Unknown stream');
  const idx = stepIdx(stepId);
  if (idx < 0) throw new Error(`Unknown step ${stepId}`);
  const set = new Set(s.skipSteps || []);
  skipped ? set.add(stepId) : set.delete(stepId);
  updateStream(streamId, { skipSteps: [...set] });
  log(streamId, { kind: 'step', text: `${skipped ? 'Will skip' : 'Will run'} ${state.workflow.steps[idx].title} for this ticket` });
  if (skipped && s.stepIndex === idx && isActive(streamId)) {
    await stopAndWait(streamId);
    updateStream(streamId, { stepIndex: idx + 1 });
    runWorkflow(streamId);
  }
}
