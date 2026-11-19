#!/usr/bin/env bash
# Workflow step "Create PR": push the branch and open a pull request.
# Env (set by All My Agents): AMA_BRANCH, AMA_BASE, AMA_PR_TITLE, AMA_TICKET_KEY, AMA_TICKET_URL
set -euo pipefail

branch="${AMA_BRANCH:-$(git branch --show-current)}"
base="${AMA_BASE:-main}"
title="${AMA_PR_TITLE:-$(git log -1 --pretty=%s)}"

echo "Pushing $branch"
git push -u origin "$branch"

if existing=$(gh pr view "$branch" --json url -q .url 2>/dev/null); then
  echo "PR already exists: $existing"
  exit 0
fi

commits=$(git log --pretty='- %s' "origin/$base..HEAD" 2>/dev/null || true)
body="## Summary
${AMA_TICKET_URL:+Ticket: [$AMA_TICKET_KEY]($AMA_TICKET_URL)}

## Changes
${commits:-_No commits listed_}

_Opened by All My Agents._"

gh pr create --base "$base" --head "$branch" --title "$title" --body "$body"
