#!/usr/bin/env bash
# stack-up.sh [--check] -- brings up the operator's own crowsnest stack on :3000
# (9router on :20128, migrated data/crowsnest.db, dev server), then smokes the routes.
# Idempotent: anything already up is left alone. --check is read-only (no start, no migrate).
set -uo pipefail
cd "$(dirname "$0")/../../../.."
CHECK=0; [ "${1:-}" = --check ] && CHECK=1
mkdir -p "$HOME/.crowsnest"
ok=1
fail() { echo "FAIL  $1"; ok=0; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-3}" "$1" 2>/dev/null; }

r="$(code http://localhost:20128)"
if [ "$r" != 000 ]; then echo "ok    9router up (HTTP $r)"
elif [ "$CHECK" = 1 ]; then fail "9router down on :20128"
else
  /opt/homebrew/bin/9router --tray --no-browser --skip-update >"$HOME/.crowsnest/9router.log" 2>&1 &
  disown 2>/dev/null || true
  for _ in $(seq 1 10); do sleep 1; r="$(code http://localhost:20128)"; [ "$r" != 000 ] && break; done
  [ "$r" != 000 ] && echo "ok    9router started (HTTP $r)" || fail "9router did not start, see ~/.crowsnest/9router.log"
fi

if [ ! -f data/crowsnest.db ]; then
  [ "$CHECK" = 1 ] && fail "no data/crowsnest.db here; run from the operator checkout, or without --check to create it"
fi
if [ "$CHECK" = 1 ] && [ -f data/crowsnest.db ]; then
  n="$(sqlite3 data/crowsnest.db 'select count(*) from __drizzle_migrations' 2>/dev/null || echo ?)"
  echo "info  data/crowsnest.db ledger has $n migrations, drizzle/ has $(ls drizzle/*.sql | wc -l | tr -d ' ') files"
elif [ "$CHECK" = 0 ]; then
  npm run -s db:migrate >"$HOME/.crowsnest/migrate.log" 2>&1 && echo "ok    db:migrate" \
    || fail "db:migrate failed, see ~/.crowsnest/migrate.log (\"table already exists\" = ledger drift, see SKILL.md)"
  npm run -s db:bootstrap >>"$HOME/.crowsnest/migrate.log" 2>&1 && echo "ok    db:bootstrap" || fail "db:bootstrap failed"
fi

r="$(code http://localhost:3000 10)"
if [ "$r" = 000 ]; then
  holder="$(lsof -nP -iTCP:3000 -sTCP:LISTEN 2>/dev/null | tail -n +2)"
  [ -n "$holder" ] && fail ":3000 held but not answering: $holder" \
    || fail "dev server down on :3000. Start it in an Orca pane (SKILL.md, Operator stack), then re-run with --check"
  [ "$ok" = 1 ]; exit $?
fi
for p in / /feed /channels/discover /mine /runs /settings; do
  r="$(code "http://localhost:3000$p" 30)"
  case "$r" in
    2??|3??) echo "ok    GET $p -> $r" ;;
    5??) fail "GET $p -> $r (a 500 on one route usually means a stale schema; run without --check)" ;;
    *) fail "GET $p -> $r" ;;
  esac
done
[ "$ok" = 1 ]
