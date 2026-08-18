#!/usr/bin/env bash
set -euo pipefail

repo="${1:-GuyMichaely/parola}"
workflow="${2:-capture-duolingo.yml}"
branch="${3:-main}"

api="https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?branch=${branch}&per_page=1"

if command -v gh >/dev/null 2>&1; then
  gh api "/repos/${repo}/actions/workflows/${workflow}/runs" \
    -f branch="${branch}" \
    -f per_page=1 \
    --jq '.workflow_runs[0] | {id, status, conclusion, event, head_sha, created_at, html_url}'
else
  auth=()
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  fi
  curl -fsSL \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' \
    "${auth[@]}" \
    "$api" \
    | python -c 'import json,sys; r=json.load(sys.stdin)["workflow_runs"][0]; print(json.dumps({k:r.get(k) for k in ("id","status","conclusion","event","head_sha","created_at","html_url")}, indent=2))'
fi
