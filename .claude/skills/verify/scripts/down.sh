#!/usr/bin/env bash
# Stops only the server up.sh started (its process group). Keeps data/verify/evidence and,
# in a worktree, copies it to the main checkout (keep-evidence.sh).
set -uo pipefail
cd "$(dirname "$0")/../../../.."
DIR=data/verify
PID="$(cat "$DIR/server.pid" 2>/dev/null || true)"
if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
  kill -TERM -- "-$PID" 2>/dev/null || kill -TERM "$PID"
  for _ in $(seq 1 20); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
  kill -0 "$PID" 2>/dev/null && kill -KILL -- "-$PID" 2>/dev/null
  echo "verify: stopped process group $PID"
else
  echo "verify: no server of ours running"
fi
rm -f "$DIR/server.pid" "$DIR/server.port"
echo "verify: evidence kept in $DIR/evidence/"
"$(dirname "$0")/keep-evidence.sh"
