// GitHub REST/GraphQL client. Uses GITHUB_TOKEN from .env, falling back to the
// token of an authenticated `gh` CLI.
import { env } from './env.js';
import { exec } from './proc.js';

let ghToken = null;

async function token() {
  const fromEnv = env('GITHUB_TOKEN');
  if (fromEnv) return fromEnv;
  if (ghToken) return ghToken;
  const r = await exec('gh', ['auth', 'token'], { timeout: 10000 });
  ghToken = r.ok ? r.stdout.trim() : '';
  return ghToken;
}

export async function hasGithubAuth() {
  return Boolean(await token());
}

async function gh(pathname, { method = 'GET', body } = {}) {
  const t = await token();
  if (!t) throw new Error('No GitHub token: set GITHUB_TOKEN in Settings > Plugins or run `gh auth login`.');
  const res = await fetch(`https://api.github.com${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${t}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'all-my-agents',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`GitHub ${method} ${pathname} → ${res.status}: ${data?.message || text}`);
  return data;
}

async function graphql(query, variables = {}) {
  const data = await gh('/graphql', { method: 'POST', body: { query, variables } });
  if (data.errors?.length) throw new Error(data.errors.map((e) => e.message).join('; '));
  return data.data;
}

export async function whoami() {
  const me = await gh('/user');
  return me.login;
}

export async function username() {
  return env('GITHUB_USERNAME') || (await whoami().catch(() => ''));
}

export async function listIssues(repo, { labels } = {}) {
  const qs = new URLSearchParams({ state: 'open', per_page: '100', sort: 'updated' });
  if (labels) qs.set('labels', labels);
  const issues = await gh(`/repos/${repo}/issues?${qs}`);
  return issues
    .filter((i) => !i.pull_request)
    .map((i) => ({
      key: `#${i.number}`,
      number: i.number,
      summary: i.title,
      assignee: i.assignees?.map((a) => a.login).join(', ') || '',
      url: i.html_url,
    }));
}

export async function isIssueClosed(repo, number) {
  const issue = await gh(`/repos/${repo}/issues/${number}`);
  return issue.state === 'closed';
}

export async function assignIssue(repo, number, login) {
  return gh(`/repos/${repo}/issues/${number}/assignees`, { method: 'POST', body: { assignees: [login] } });
}

const PR_FIELDS = `
  ... on PullRequest {
    id number title url headRefName baseRefName updatedAt isDraft
    mergeable mergeStateStatus reviewDecision
    author { login }
    repository { nameWithOwner }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  }`;

function mapPr(n) {
  return {
    id: n.id,
    number: n.number,
    title: n.title,
    url: n.url,
    repo: n.repository.nameWithOwner,
    branch: n.headRefName,
    base: n.baseRefName,
    updatedAt: n.updatedAt,
    isDraft: n.isDraft,
    author: n.author?.login,
    mergeable: n.mergeable, // MERGEABLE | CONFLICTING | UNKNOWN
    mergeState: n.mergeStateStatus, // CLEAN | BLOCKED | BEHIND | DIRTY | UNSTABLE | HAS_HOOKS | UNKNOWN | DRAFT
    reviewDecision: n.reviewDecision,
    checks: n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state || null, // SUCCESS | FAILURE | PENDING | ERROR
  };
}

export async function listPullRequests() {
  const data = await graphql(`
    query {
      mine: search(query: "is:pr is:open author:@me archived:false sort:updated-desc", type: ISSUE, first: 50) { nodes { ${PR_FIELDS} } }
      review: search(query: "is:pr is:open review-requested:@me archived:false sort:updated-desc", type: ISSUE, first: 50) { nodes { ${PR_FIELDS} } }
    }`);
  return {
    mine: data.mine.nodes.filter((n) => n.number).map(mapPr),
    reviewRequested: data.review.nodes.filter((n) => n.number).map(mapPr),
  };
}

export async function getPullRequest(repo, number) {
  const [owner, name] = repo.split('/');
  const data = await graphql(
    `query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) { pullRequest(number: $number) { state merged ${PR_FIELDS} } }
    }`,
    { owner, name, number: Number(number) },
  );
  const pr = data.repository.pullRequest;
  return { ...mapPr(pr), state: pr.state, merged: pr.merged };
}

export async function approvePullRequest(repo, number) {
  return gh(`/repos/${repo}/pulls/${number}/reviews`, { method: 'POST', body: { event: 'APPROVE' } });
}

export async function mergePullRequest(repo, number, method = 'squash') {
  return gh(`/repos/${repo}/pulls/${number}/merge`, { method: 'PUT', body: { merge_method: method } });
}
