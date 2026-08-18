#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_FILE="$ROOT/extension/tests/fixtures/duolingo-session-state.b64"
PUSH=1
AUTO=0

usage() {
  cat <<'EOF'
Usage: bash scripts/refresh-duolingo-session-local.sh [--auto-login] [--no-push]

Creates a disposable local Chrome profile, waits for an authenticated Duolingo
session, writes the reusable session state into the repository, commits it, and
pushes it so GitHub-hosted CI can restore the session.

Options:
  --auto-login  Try the automated Autofill + paste login first. If it fails,
                fall back to manual login in the opened Chrome window.
  --no-push     Update and commit the state locally, but do not git push.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --auto-login) AUTO=1 ;;
    --no-push) PUSH=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

cd "$ROOT"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required." >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required." >&2
  exit 1
fi

CHROME="${CHROME_PATH:-}"
if [[ -z "$CHROME" ]]; then
  for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      CHROME="$(command -v "$candidate")"
      break
    fi
  done
fi
if [[ -z "$CHROME" || ! -x "$CHROME" ]]; then
  echo "Chrome/Chromium was not found. Set CHROME_PATH to the browser executable." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "The repository has tracked local changes. Commit/stash them before refreshing the session." >&2
  exit 1
fi

TMP="$(mktemp -d -t parola-duolingo-session-XXXXXX)"
PROFILE="$TMP/chrome-profile"
VENV="$TMP/venv"
PORT="$(python3 - <<'PY'
import socket
s = socket.socket()
s.bind(('127.0.0.1', 0))
print(s.getsockname()[1])
s.close()
PY
)"
CHROME_PID=""

cleanup() {
  if [[ -n "$CHROME_PID" ]] && kill -0 "$CHROME_PID" 2>/dev/null; then
    kill "$CHROME_PID" 2>/dev/null || true
    wait "$CHROME_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install -q -r "$ROOT/extension/tests/requirements-live.txt"

mkdir -p "$PROFILE"
"$CHROME" \
  --user-data-dir="$PROFILE" \
  --remote-debugging-port="$PORT" \
  --remote-debugging-address=127.0.0.1 \
  --no-first-run \
  --no-default-browser-check \
  https://www.duolingo.com/log-in \
  >"$TMP/chrome.stdout" 2>"$TMP/chrome.stderr" &
CHROME_PID=$!

READY=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    READY=1
    break
  fi
  if ! kill -0 "$CHROME_PID" 2>/dev/null; then
    break
  fi
  sleep 0.25
done
if [[ "$READY" != 1 ]]; then
  echo "Chrome did not expose its debugging endpoint." >&2
  cat "$TMP/chrome.stderr" >&2 || true
  exit 1
fi

export DUOLINGO_CDP_HOST=127.0.0.1
export DUOLINGO_CDP_PORT="$PORT"

if [[ "$AUTO" == 1 ]]; then
  echo "Trying the automated Autofill + paste login first..."
  (
    cd "$ROOT/extension"
    DUOLINGO_CAPTURE_DIR="$TMP/auto-login" \
      "$VENV/bin/python" tests/duolingo-gold-replay.py
  ) || echo "Automated login was rejected; falling back to manual login."
fi

echo
echo "A disposable Chrome window is open. If it is not already logged in, log into the disposable Duolingo test account there."
echo "This script will detect authentication automatically (10 minute timeout)."
(
  cd "$ROOT/extension"
  DUOLINGO_AUTH_WAIT_SECONDS=600 \
    "$VENV/bin/python" tests/duolingo-wait-for-auth.py
)

mkdir -p "$(dirname "$STATE_FILE")"
(
  cd "$ROOT/extension"
  DUOLINGO_SESSION_OUTPUT="$STATE_FILE" \
    "$VENV/bin/python" tests/duolingo-export-session.py
)

if git diff --quiet -- "$STATE_FILE" && git diff --cached --quiet -- "$STATE_FILE"; then
  echo "Session state is unchanged; nothing to commit."
  exit 0
fi

git add "$STATE_FILE"
git commit -m "Refresh disposable Duolingo test session"

if [[ "$PUSH" == 1 ]]; then
  git pull --rebase origin "$(git branch --show-current)"
  git push
  echo "Session state pushed. GitHub-hosted session-restore CI will validate it automatically."
else
  echo "Session state committed locally. Push this commit when ready."
fi
