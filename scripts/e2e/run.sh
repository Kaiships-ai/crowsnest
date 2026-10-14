#!/usr/bin/env bash
# Runs the browse-e2e journeys end to end (npm run e2e):
#
#   1. Seed a fixture SQLite database at CROWSNEST_DB_PATH=data/e2e.db
#      (scripts/seed-e2e.ts), fresh on every run.
#   2. Start the dev server on :3001 against that database.
#   3. Wait for it to answer.
#   4. Run every scripts/e2e/*-e2e-*.sh journey in turn.
#   5. Stop the server, and exit non-zero if any journey failed.
#
# A journey script is the browse skill driven from a script, not
# a Playwright suite -- there is no spec file format here beyond "one shell script per
# case, using the browse CLI".
set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"

export CROWSNEST_DB_PATH="${CROWSNEST_DB_PATH:-data/e2e.db}"
export BASE_URL="${BASE_URL:-http://localhost:3001}"
PORT="${PORT:-3001}"
SERVER_LOG="$(mktemp -t e2e-server-XXXXXX.log 2>/dev/null || echo /tmp/e2e-server-$$.log)"
SERVER_PID=""

say() { printf '\n==> %s\n' "$*"; }

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    say "stopping dev server (pid $SERVER_PID)"
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

say "seeding fixture database at $CROWSNEST_DB_PATH"
npx tsx scripts/seed-e2e.ts

say "starting dev server on :$PORT against $CROWSNEST_DB_PATH"
PORT="$PORT" CROWSNEST_DB_PATH="$CROWSNEST_DB_PATH" npm run dev >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

say "waiting for :$PORT to answer"
READY=""
for _ in $(seq 1 60); do
  if curl -fs -o /dev/null --max-time 1 "$BASE_URL/feed" 2>/dev/null; then
    READY="1"
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "e2e: dev server exited before it came up -- see $SERVER_LOG" >&2
    tail -n 60 "$SERVER_LOG" >&2 || true
    exit 1
  fi
  sleep 1
done
if [ -z "$READY" ]; then
  echo "e2e: dev server never answered on :$PORT after 60s -- see $SERVER_LOG" >&2
  tail -n 60 "$SERVER_LOG" >&2 || true
  exit 1
fi
say "dev server is up"

FAILED=0
PASSED=0
for journey in scripts/e2e/*-e2e-*.sh; do
  [ -f "$journey" ] || continue
  say "running $journey"
  if bash "$journey"; then
    PASSED=$((PASSED + 1))
  else
    echo "FAILED: $journey" >&2
    FAILED=$((FAILED + 1))
  fi
done

say "$PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
