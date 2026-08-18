#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

: "${DUOLINGO_CDP_HOST:=127.0.0.1}"
: "${DUOLINGO_CDP_PORT:=9222}"

python -m pip install -r "$ROOT/extension/tests/requirements-live.txt" >/dev/null
DUOLINGO_CDP_HOST="$DUOLINGO_CDP_HOST" \
DUOLINGO_CDP_PORT="$DUOLINGO_CDP_PORT" \
DUOLINGO_SESSION_OUTPUT="$TMP" \
python "$ROOT/extension/tests/duolingo-export-session.py"

BYTES="$(wc -c < "$TMP" | tr -d ' ')"
if (( BYTES > 48000 )); then
  echo "Compressed session state is ${BYTES} bytes, too large for a normal GitHub Actions secret." >&2
  exit 1
fi

gh secret set DUOLINGO_SESSION_STATE_B64 < "$TMP"
echo "Updated repository Actions secret DUOLINGO_SESSION_STATE_B64 (${BYTES} bytes)."
