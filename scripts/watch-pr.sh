#!/usr/bin/env bash
# Workflow step "Watch PR": poll the PR until every check is done.
#   exit 0 → all checks green, no conflicts, no changes requested (ready for review/merge)
#   exit 1 → failing checks, merge conflicts or changes requested (→ Resolve PR Feedback)
#   exit 2 → timed out waiting for checks
# Env: AMA_BRANCH (defaults to current branch), WATCH_INTERVAL (s, default 30), WATCH_TIMEOUT (s, default 2700)
set -uo pipefail

branch="${AMA_BRANCH:-$(git branch --show-current)}"
interval="${WATCH_INTERVAL:-30}"
timeout="${WATCH_TIMEOUT:-2700}"
start=$(date +%s)

PENDING='[.statusCheckRollup[] | select(((.status // "COMPLETED") != "COMPLETED") or ((.state // "") == "PENDING") or ((.state // "") == "EXPECTED"))] | length'
FAILING='[.statusCheckRollup[] | select(((.conclusion // "") as $c | ["FAILURE","TIMED_OUT","CANCELLED","ACTION_REQUIRED","STARTUP_FAILURE"] | index($c)) or ((.state // "") as $s | ["FAILURE","ERROR"] | index($s)))] | (map(.name // .context) | join(", "))'

while :; do
  if ! json=$(gh pr view "$branch" --json state,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup 2>&1); then
    echo "Could not read PR for $branch: $json"
    exit 1
  fi
  state=$(jq -r .state <<<"$json")
  mergeable=$(jq -r .mergeable <<<"$json")
  merge_state=$(jq -r .mergeStateStatus <<<"$json")
  review=$(jq -r '.reviewDecision // "NONE"' <<<"$json")
  pending=$(jq -r "$PENDING" <<<"$json")
  failing=$(jq -r "$FAILING" <<<"$json")

  echo "state=$state mergeable=$mergeable mergeState=$merge_state review=$review pending=$pending failing=${failing:-none}"

  if [[ "$state" == "MERGED" ]]; then echo "PR is merged."; exit 0; fi
  if [[ "$state" == "CLOSED" ]]; then echo "PR is closed."; exit 1; fi
  if [[ -n "$failing" ]]; then echo "Failing checks: $failing"; exit 1; fi
  if [[ "$mergeable" == "CONFLICTING" ]]; then echo "PR has merge conflicts."; exit 1; fi
  if [[ "$review" == "CHANGES_REQUESTED" ]]; then echo "Reviewer requested changes."; exit 1; fi
  if [[ "$pending" == "0" && "$mergeable" == "MERGEABLE" ]]; then
    echo "All checks green and PR is mergeable."
    exit 0
  fi
  if (( $(date +%s) - start > timeout )); then echo "Timed out after ${timeout}s waiting for checks."; exit 2; fi
  sleep "$interval"
done
