#!/usr/bin/env bash
#
# Adopts an Instagram web session instead of authenticating with a password.
#
# Why this exists: Instagram will accept a password in a browser and still answer
# `BadPassword` to the private API when it distrusts the IP or device — its own error
# text says so. Observed here across two accounts whose credentials were verified
# working on instagram.com. Importing the browser's `sessionid` sidesteps the login
# endpoint entirely, and performs no password authentication, so it cannot add to the
# failed-login count that gets accounts checkpointed.
#
# Usage:
#   ./scripts/import-session.sh <sessionid>     # paste it explicitly
#   ./scripts/import-session.sh                 # pull it from the browse browser
#
# Getting the sessionid by hand, in the browser where you are signed in:
#   DevTools -> Application -> Cookies -> https://www.instagram.com -> `sessionid`
#
set -uo pipefail
cd "$(dirname "$0")/.."

SESSIONID="${1:-}"
BROWSE="$HOME/.claude/skills/gstack/browse/dist/browse"

fail() { echo "FAILED: $*" >&2; exit 1; }

TOKEN=$(grep '^IG_SERVICE_TOKEN=' .env.local 2>/dev/null | cut -d= -f2-)
[ -n "$TOKEN" ] || fail "IG_SERVICE_TOKEN missing from .env.local"
URL="${IG_SERVICE_URL:-http://127.0.0.1:8765}"

curl -sf -o /dev/null -H "X-IG-Token: $TOKEN" "$URL/health" \
  || fail "sidecar unreachable at $URL — run 'pnpm run ig:service'"

# No sessionid given: try to read one out of the browse browser's cookie jar.
if [ -z "$SESSIONID" ] && [ -x "$BROWSE" ]; then
  echo "no sessionid given — checking the browse browser…"
  SESSIONID=$("$BROWSE" cookies 2>/dev/null | python3 -c "
import sys, json
raw = sys.stdin.read()
try:
    data = json.loads(raw[raw.index('['):raw.rindex(']')+1])
except Exception:
    sys.exit(0)
for c in data:
    if c.get('name') == 'sessionid' and 'instagram' in (c.get('domain') or ''):
        print((c.get('value') or '').strip())
        break
" || true)
fi

[ -n "$SESSIONID" ] || fail "no sessionid found. Log in at instagram.com, then copy the 'sessionid' cookie (DevTools -> Application -> Cookies) and pass it: ./scripts/import-session.sh <sessionid>"

echo "importing session (${#SESSIONID} chars)…"
RESP=$(curl -s -m 120 -X POST -H "X-IG-Token: $TOKEN" -H 'Content-Type: application/json' \
        --data-binary "$(python3 -c 'import json,sys; print(json.dumps({"sessionid": sys.argv[1]}))' "$SESSIONID")" \
        "$URL/login-by-session")

echo "$RESP" | python3 -m json.tool 2>/dev/null || echo "$RESP"
echo "$RESP" | grep -q '"status": *"ok"' || fail "session import rejected — the cookie is probably stale; grab a fresh one"

echo
echo "=== health after import ==="
curl -s -H "X-IG-Token: $TOKEN" "$URL/health" | python3 -m json.tool | grep -E 'logged_in|username|session_loaded'
echo
echo "Session adopted. Next: open the app and run a sync."
