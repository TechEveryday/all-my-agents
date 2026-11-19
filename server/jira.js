// Jira Cloud REST client (basic auth with email + API token from .env).
import { env } from './env.js';

function config() {
  const base = env('JIRA_BASE_URL').replace(/\/+$/, '');
  const email = env('JIRA_EMAIL');
  const token = env('JIRA_API_TOKEN');
  if (!base || !email || !token) {
    throw new Error('Jira is not configured: set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN in Settings > Plugins.');
  }
  return { base, auth: Buffer.from(`${email}:${token}`).toString('base64') };
}

export function jiraConfigured() {
  return Boolean(env('JIRA_BASE_URL') && env('JIRA_EMAIL') && env('JIRA_API_TOKEN'));
}

async function jira(pathname, { method = 'GET', body } = {}) {
  const { base, auth } = config();
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.errorMessages?.join('; ') || (data?.errors && JSON.stringify(data.errors)) || text.slice(0, 200);
    const err = new Error(`Jira ${method} ${pathname.split('?')[0]} → ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

let myself = null;
export async function getMyself() {
  if (!myself) myself = await jira('/rest/api/3/myself');
  return myself;
}

export function defaultJql(projectKey) {
  const project = projectKey ? `project = "${projectKey}" AND ` : '';
  return `${project}statusCategory != Done AND (assignee is EMPTY OR assignee = currentUser()) ORDER BY Rank ASC`;
}

export async function searchIssues(jql) {
  const fields = 'summary,assignee,status,issuetype,priority';
  const qs = new URLSearchParams({ jql, fields, maxResults: '100' });
  let data;
  try {
    data = await jira(`/rest/api/3/search/jql?${qs}`);
  } catch (err) {
    if (err.status !== 404) throw err;
    data = await jira(`/rest/api/3/search?${qs}`); // older Jira deployments
  }
  const { base } = config();
  return (data.issues || []).map((i) => ({
    key: i.key,
    summary: i.fields.summary,
    assignee: i.fields.assignee?.displayName || '',
    status: i.fields.status?.name || '',
    url: `${base}/browse/${i.key}`,
  }));
}

export async function assignToMe(key) {
  const me = await getMyself();
  await jira(`/rest/api/3/issue/${encodeURIComponent(key)}/assignee`, { method: 'PUT', body: { accountId: me.accountId } });
}

export async function isDone(key) {
  const issue = await jira(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=status`);
  return issue.fields?.status?.statusCategory?.key === 'done';
}

/** Best effort: move the issue to the first transition named like "In Progress". */
export async function startProgress(key) {
  const { transitions = [] } = await jira(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
  const t = transitions.find((x) => /in progress/i.test(x.name) || /in progress/i.test(x.to?.name || ''));
  if (!t) return false;
  await jira(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { method: 'POST', body: { transition: { id: t.id } } });
  return true;
}
