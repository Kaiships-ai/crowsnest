#!/usr/bin/env bash
# Read-only: is the verify instance up, ours, and serving the seeded app?
set -uo pipefail
cd "$(dirname "$0")/../../../.."
DIR=data/verify
ok=1
fail() { echo "FAIL  $1"; ok=0; }
pass() { echo "ok    $1"; }

PID="$(cat "$DIR/server.pid" 2>/dev/null || true)"
PORT="$(cat "$DIR/server.port" 2>/dev/null || echo 3001)"
[ -n "$PID" ] && kill -0 "$PID" 2>/dev/null && pass "server pid $PID alive" || fail "no live server pid in $DIR/server.pid (run up.sh)"

OWNER="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)"
if [ -z "$OWNER" ]; then fail ":$PORT has no listener"
elif [ -n "$PID" ] && [ "$(ps -o pgid= -p "$OWNER" | tr -d ' ')" = "$PID" ]; then pass ":$PORT owned by our process group"
else fail ":$PORT owned by pid $OWNER, not our group $PID; do not drive it"; fi

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:$PORT/feed")"
[ "$code" = 200 ] && pass "GET /feed -> 200" || fail "GET /feed -> $code"
[ -f data/e2e.db ] && pass "fixture db data/e2e.db present" || fail "data/e2e.db missing"

BROWSE="$HOME/.claude/skills/gstack/browse/dist/browse"
[ -x "$BROWSE" ] && pass "browse CLI at $BROWSE" || fail "browse CLI missing at $BROWSE"
curl -fs -o /dev/null --max-time 1 http://127.0.0.1:8765/health && echo "note  IG sidecar is UP on :8765 (ig-sync journey expects it down)"
[ "$ok" = 1 ]
