#!/usr/bin/env bash
# heavy.sh <command...> -- runs a heavy job (build, test, typecheck, app launch) one at a time
# per machine, at low priority. Agents in parallel worktrees share one Mac; two builds plus a
# vitest fan-out at once pushed it into 13 GB of swap.
set -uo pipefail
[ $# -gt 0 ] || { echo "usage: heavy.sh <command...>" >&2; exit 2; }

# Nested calls (up.sh -> npm run build) already hold the lock; CI runners are not shared.
if [ -n "${HEAVY_HELD:-}" ] || [ -n "${CI:-}" ]; then exec "$@"; fi

if [ "$(uname)" = Darwin ]; then
  free=$(memory_pressure -Q 2>/dev/null | awk -F': ' '/free percentage/ { print $2 + 0 }')
  if [ -n "$free" ] && [ "$free" -lt "${HEAVY_MIN_FREE:-15}" ]; then
    echo "heavy: only ${free}% memory free, running with 1 worker. Close idle agent sessions or run /dev-reaper." >&2
    export HEAVY_WORKERS=1
  fi
fi

LOCK="${HEAVY_LOCK:-/tmp/crowsnest-heavy-$(id -u).lock}"
export HEAVY_HELD=1
if command -v lockf >/dev/null; then
  lockf -k -t 0 "$LOCK" true 2>/dev/null || echo "heavy: another heavy job holds $LOCK, waiting" >&2
  exec lockf -k "$LOCK" nice -n 10 "$@"
fi
exec flock "$LOCK" nice -n 10 "$@"
