#!/usr/bin/env bash
# Stops only the app app-up.sh started (its host process group), removes its temp profile, and
# in a worktree copies data/verify/evidence to the main checkout (keep-evidence.sh).
set -uo pipefail
cd "$(dirname "$0")/../../../.."
DIR=data/verify/app
PID="$(cat "$DIR/host.pid" 2>/dev/null || true)"
if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
  kill -TERM "$PID"
  for _ in $(seq 1 30); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
  kill -0 "$PID" 2>/dev/null && kill -KILL -- "-$PID" 2>/dev/null
  echo "app: stopped host $PID"
else
  echo "app: no app of ours running"
fi
rm -f "$DIR/host.pid" "$DIR/state.json"
"$(dirname "$0")/keep-evidence.sh"
