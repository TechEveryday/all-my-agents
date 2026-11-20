// Made-up demo data for README screenshots. Every /api call is answered from
// here, so no real tickets, PRs, paths or tokens ever appear in the images.

const now = Date.now();
const ago = (min) => new Date(now - min * 60 * 1000).toISOString();
const WT = '/Users/you/.all-my-agents/worktrees';

export const steps = [
  { id: 'plan', title: 'Plan', description: 'Create a plan to implement the claimed ticket.', runs: 'skill', skill: '', script: '', model: 'claude:opus', model2: '', effort: 'high', skip: false },
  { id: 'implement', title: 'Implement', description: 'Execute the plan and commit the work.', runs: 'skill', skill: '', script: '', model: 'claude:opus', model2: '', effort: 'high', skip: false },
  { id: 'review', title: 'Review', description: 'Local review of the branch by both Claude and Cursor.', runs: 'skill', skill: 'code-review', script: '', model: 'claude:opus', model2: 'cursor:auto', effort: 'high', skip: false },
  { id: 'fix', title: 'Fix findings', description: 'Validate each review finding, then fix the ones that hold up.', runs: 'skill', skill: '', script: '', model: 'claude:opus', model2: '', effort: 'medium', skip: false },
  { id: 'validate', title: 'Validation', description: 'Run the tests and make sure the branch builds as is.', runs: 'script', skill: '', script: 'npm test && npm run build', model: 'claude:sonnet', model2: '', effort: 'medium', skip: false },
  { id: 'create-pr', title: 'Create PR', description: 'Push the branch and open a pull request.', runs: 'script', skill: '', script: 'scripts/create-pr.sh', model: 'claude:sonnet', model2: '', effort: 'low', skip: false },
  { id: 'watch-pr', title: 'Watch PR', description: 'Poll the PR until every check is green and it can be merged.', runs: 'script', skill: '', script: 'scripts/watch-pr.sh', model: 'claude:sonnet', model2: '', effort: 'low', skip: false },
  { id: 'pr-feedback', title: 'Resolve PR Feedback', description: 'Address feedback from pipeline jobs, bots and humans.', runs: 'skill', skill: '', script: '', model: 'claude:opus', model2: '', effort: 'high', skip: false },
];

const streams = [
  {
    id: 's-398',
    ticket: { id: 'jira:PAY-398', key: 'PAY-398', summary: 'Retry payout webhooks with exponential backoff', url: 'https://example.atlassian.net/browse/PAY-398', type: 'jira' },
    repoName: 'payments-api', ghRepo: 'acme/payments-api', branch: 'feature/pay-398-retry-payout-webhooks', base: 'main',
    worktreePath: `${WT}/payments-api/pay-398`, stepIndex: 1, stage: 'Implement', status: 'Running', statusDetail: '',
    costUsd: 2.14, costByStep: { Plan: 0.61, Implement: 1.53 }, model: 'claude:opus',
    app: { running: true, url: 'http://localhost:51873', command: 'npm run dev', port: 51873 }, updatedAt: ago(1),
  },
  {
    id: 's-401',
    ticket: { id: 'jira:PAY-401', key: 'PAY-401', summary: 'Show refund status on the order timeline', url: 'https://example.atlassian.net/browse/PAY-401', type: 'jira' },
    repoName: 'web-app', ghRepo: 'acme/web-app', branch: 'feature/pay-401-refund-status-timeline', base: 'main',
    worktreePath: `${WT}/web-app/pay-401`, stepIndex: 6, stage: 'Watch PR', status: 'In Code review', statusDetail: 'Checks green, waiting on review/merge',
    pr: { number: 128, url: 'https://github.com/acme/web-app/pull/128' },
    costUsd: 4.87, costByStep: { Plan: 0.58, Implement: 2.31, Review: 0.97, 'Fix findings': 0.66, Validation: 0.35 }, updatedAt: ago(42),
  },
  {
    id: 's-57',
    ticket: { id: 'gh:web-app#57', key: 'web-app#57', summary: 'Date picker ignores the user locale', url: 'https://github.com/acme/web-app/issues/57', type: 'github' },
    repoName: 'web-app', ghRepo: 'acme/web-app', branch: 'feature/web-app-57-date-picker-locale', base: 'main',
    worktreePath: `${WT}/web-app/web-app-57`, stepIndex: 4, stage: 'Validation', status: 'Needs attention', statusDetail: 'Validation failed',
    costUsd: 1.12, costByStep: { Plan: 0.31, Implement: 0.81 }, costUnknownRuns: 1, updatedAt: ago(18),
  },
  {
    id: 's-377',
    ticket: { id: 'jira:PAY-377', key: 'PAY-377', summary: 'Idempotency keys for card captures', url: 'https://example.atlassian.net/browse/PAY-377', type: 'jira' },
    repoName: 'payments-api', ghRepo: 'acme/payments-api', branch: 'feature/pay-377-idempotency-keys', base: 'main',
    worktreePath: `${WT}/payments-api/pay-377`, worktreeRemoved: true, stepIndex: 8, stage: 'Complete', status: 'Merged', statusDetail: '',
    pr: { number: 311, url: 'https://github.com/acme/payments-api/pull/311' },
    costUsd: 6.02, costByStep: { Plan: 0.72, Implement: 2.94, Review: 1.08, 'Fix findings': 0.61, Validation: 0.22, 'Resolve PR Feedback': 0.45 }, updatedAt: ago(60 * 26),
  },
];

const t = (min, entry) => ({ ts: ago(min), ...entry });
const activity = {
  's-398': [
    t(14, { kind: 'step', step: 'Claim', text: 'Claiming PAY-398: Retry payout webhooks with exponential backoff' }),
    t(14, { kind: 'system', step: 'Claim', text: 'git worktree add -b feature/pay-398-retry-payout-webhooks …/payments-api/pay-398 origin/main' }),
    t(14, { kind: 'system', step: 'Claim', text: 'Assigned PAY-398 to you in Jira · Moved PAY-398 to In Progress' }),
    t(13, { kind: 'step', step: 'Plan', text: '▶ Plan' }),
    t(13, { kind: 'system', step: 'Plan', text: 'Running Claude Code (opus, high)' }),
    t(13, { kind: 'tool', step: 'Plan', text: 'Grep: deliverPayoutWebhook' }),
    t(12, { kind: 'tool', step: 'Plan', text: 'Read: src/webhooks/payouts.ts' }),
    t(12, { kind: 'tool', step: 'Plan', text: 'Write: .all-my-agents/PLAN.md' }),
    t(11, { kind: 'agent', step: 'Plan', model: 'claude:opus', text: 'Plan written to .all-my-agents/PLAN.md:\n1. Wrap deliverPayoutWebhook in a retry helper (5 attempts, 2ˣ backoff with jitter, max 5 min).\n2. Retry only on network errors and 5xx; 4xx goes straight to the dead-letter table.\n3. Persist attempt count on webhook_deliveries so restarts resume.\n4. Tests for the backoff schedule and the 4xx short-circuit.' }),
    t(11, { kind: 'system', step: 'Plan', text: 'Agent finished · 94s · $0.61' }),
    t(11, { kind: 'step', step: 'Plan', text: '✓ Plan done' }),
    t(10, { kind: 'step', step: 'Implement', text: '▶ Implement' }),
    t(10, { kind: 'system', step: 'Implement', text: 'Running Claude Code (opus, high) · resumed session' }),
    t(9, { kind: 'tool', step: 'Implement', text: 'Edit: src/webhooks/retry.ts' }),
    t(8, { kind: 'tool', step: 'Implement', text: 'Edit: src/webhooks/payouts.ts' }),
    t(7, { kind: 'tool', step: 'Implement', text: 'Bash: npx prisma migrate dev --name webhook_attempts' }),
    t(6, { kind: 'step', step: 'App', text: '$ npm run dev  (PORT=51873)' }),
    t(6, { kind: 'system', step: 'App', text: 'App is up at http://localhost:51873' }),
    t(4, { kind: 'user', step: 'Chat', model: 'claude:opus', text: 'Make sure the dead-letter rows include the last response body.' }),
    t(4, { kind: 'agent', step: 'Implement', model: 'claude:opus', text: 'Good call — I added last_response_body (truncated to 4 KB) to webhook_dead_letters and a test that asserts it is stored for a 422.' }),
    t(2, { kind: 'tool', step: 'Implement', text: 'Bash: npm test -- webhooks' }),
    t(1, { kind: 'agent', step: 'Implement', model: 'claude:opus', text: '18 tests pass. Committing: "PAY-398: retry payout webhooks with exponential backoff".' }),
  ],
};

const todos = [
  { id: 'jira:PAY-412', sourceId: 'jira', type: 'jira', key: 'PAY-412', summary: 'Export settlements as CSV from the admin dashboard', assignee: '', status: 'To Do' },
  { id: 'jira:PAY-415', sourceId: 'jira', type: 'jira', key: 'PAY-415', summary: 'Rate-limit the public quotes endpoint', assignee: '', status: 'To Do' },
  { id: 'jira:PAY-409', sourceId: 'jira', type: 'jira', key: 'PAY-409', summary: 'Flaky test: ledger reconciliation at month end', assignee: 'Sam Rivera', status: 'In Progress' },
  { id: 'gh:web-app#61', sourceId: 'gh-web', type: 'github', key: 'web-app#61', summary: 'Dark mode contrast on disabled buttons', assignee: '' },
  { id: 'gh:web-app#63', sourceId: 'gh-web', type: 'github', key: 'web-app#63', summary: 'Keyboard focus is lost after closing the cart drawer', assignee: '' },
  { id: 'other:1', sourceId: 'other', type: 'other', key: 'OTHER-3', summary: 'Bump Node to 22 in CI images', assignee: 'you', repo: 'web-app' },
].map((i) => ({ ...i, url: i.type === 'jira' ? `https://example.atlassian.net/browse/${i.key}` : i.type === 'github' ? `https://github.com/acme/web-app/issues/${i.key.split('#')[1]}` : '' }));

const pr = (o) => ({ isDraft: false, base: 'main', checks: 'SUCCESS', reviewDecision: null, mergeable: 'MERGEABLE', mergeState: 'CLEAN', ...o, id: `${o.repo}#${o.number}`, url: `https://github.com/${o.repo}/pull/${o.number}` });
const prs = {
  mine: [
    pr({ repo: 'acme/web-app', number: 128, title: 'PAY-401: Show refund status on the order timeline', branch: 'feature/pay-401-refund-status-timeline', author: 'you', updatedAt: ago(42), reviewDecision: 'REVIEW_REQUIRED', mergeState: 'BLOCKED' }),
    pr({ repo: 'acme/payments-api', number: 315, title: 'PAY-390: Move FX rates to the pricing service', branch: 'feature/pay-390-fx-rates', author: 'you', updatedAt: ago(60 * 3), reviewDecision: 'APPROVED' }),
    pr({ repo: 'acme/payments-api', number: 309, title: 'PAY-366: Drop the legacy v1 refunds route', branch: 'feature/pay-366-drop-v1-refunds', author: 'you', updatedAt: ago(60 * 27), mergeable: 'CONFLICTING', mergeState: 'DIRTY' }),
  ],
  reviewRequested: [
    pr({ repo: 'acme/web-app', number: 131, title: 'Checkout: remember the last used payment method', branch: 'sam/remember-payment-method', author: 'sam-rivera', updatedAt: ago(25), checks: 'PENDING', mergeState: 'BLOCKED' }),
    pr({ repo: 'acme/payments-api', number: 318, title: 'Chargebacks: notify the merchant webhook', branch: 'lee/chargeback-webhook', author: 'lee-park', updatedAt: ago(60 * 5), checks: 'FAILURE', mergeState: 'UNSTABLE' }),
  ],
};

const models = [
  ...['fable', 'opus', 'sonnet', 'haiku'].map((m) => ({ value: `claude:${m}`, harness: 'claude', harnessLabel: 'Claude Code', model: m, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] })),
  ...['auto', 'gpt-5', 'sonnet-4.5'].map((m) => ({ value: `cursor:${m}`, harness: 'cursor', harnessLabel: 'Cursor Agent', model: m, efforts: [] })),
];

const skills = [
  { name: 'code-review', description: 'Review the current diff for correctness bugs and risky changes.', source: 'Claude skills', installed: true, enabled: true },
  { name: 'commit', description: 'Write a conventional commit for the staged changes.', source: 'Claude skills', installed: true, enabled: true },
  { name: 'security-review', description: 'Complete a security review of the pending changes on the current branch.', source: 'Claude skills', installed: true, enabled: true },
  { name: 'testing:run-tests', description: 'Find and run the project test suite, then summarize failures.', source: 'Plugin · testing', installed: true, enabled: true },
  { name: 'pr-feedback', description: 'Gather CI failures and review comments on a PR and address them.', source: 'Repo · web-app', installed: true, enabled: true },
  { name: 'frontend-design', description: 'Design guidance for building polished UI components.', source: 'Marketplace · claude-plugins-official', installed: false, enabled: false },
];

const envFields = [
  { key: 'JIRA_BASE_URL', label: 'Jira base URL', group: 'Jira', value: 'https://example.atlassian.net', isSet: true },
  { key: 'JIRA_EMAIL', label: 'Jira email', group: 'Jira', value: 'you@example.com', isSet: true },
  { key: 'JIRA_USERNAME', label: 'Jira username', group: 'Jira', placeholder: 'Display name (optional)', value: '', isSet: false },
  { key: 'JIRA_API_TOKEN', label: 'Jira API token', group: 'Jira', secret: true, value: '', isSet: true },
  { key: 'GITHUB_USERNAME', label: 'GitHub username', group: 'GitHub', value: 'you', isSet: true },
  { key: 'GITHUB_EMAIL', label: 'GitHub email', group: 'GitHub', value: 'you@users.noreply.github.com', isSet: true },
  { key: 'GITHUB_TOKEN', label: 'GitHub token', group: 'GitHub', secret: true, value: '', isSet: false, hint: 'Optional: falls back to `gh auth token`' },
];

/** Response body for an /api path, or undefined for unknown routes. */
export function fixture(pathname) {
  const m = pathname.match(/^\/api\/streams\/([^/]+)\/activity$/);
  if (m) return { activity: activity[m[1]] || [] };
  return {
    '/api/meta': { platform: 'darwin', commit: { sha: '6676db6f2c1e', short: '6676db6', dirty: false }, github: { login: 'you', url: 'https://github.com' } },
    '/api/settings': { reposRoot: '/Users/you/repos', worktreesRoot: '/Users/you/.all-my-agents/worktrees', branchPrefix: 'feature/', autoPickup: true, deleteWorktreeOnDone: true, notifyAttention: true, permissionMode: 'auto', mergeMethod: 'squash', maxFeedbackLoops: 3, defaultModel: 'claude:opus' },
    '/api/streams': { streams },
    '/api/models': { models },
    '/api/workflow': { steps, commit: { runs: 'skill', skill: 'commit', script: '' } },
    '/api/sources': { sources: [{ id: 'jira', type: 'jira', label: 'Jira', project: 'PAY' }, { id: 'gh-web', type: 'github', label: 'GH - web-app', repo: 'acme/web-app' }], tabNames: { all: 'All', other: 'Other' }, jiraConfigured: true },
    '/api/todos': { items: todos, errors: [] },
    '/api/repos': { repos: ['payments-api', 'web-app', 'mobile-app', 'infra'].map((name) => ({ name, path: `/Users/you/repos/${name}` })) },
    '/api/prs': prs,
    '/api/scripts': { scripts: ['scripts/create-pr.sh', 'scripts/watch-pr.sh'] },
    '/api/skills': { skills },
    '/api/env': { fields: envFields },
    '/api/harnesses': {
      harnesses: [
        { id: 'claude', label: 'Claude Code', enabled: true, installed: true, path: '/Users/you/.local/bin/claude', version: '2.1.318 (Claude Code)', customModels: [] },
        { id: 'cursor', label: 'Cursor Agent', enabled: true, installed: true, path: '/Users/you/.local/bin/cursor-agent', version: '2026.01.28', customModels: ['sonnet-4.5'] },
        { id: 'codex', label: 'Codex', enabled: false, installed: false, path: '', version: '', customModels: [] },
      ],
    },
  }[pathname];
}
