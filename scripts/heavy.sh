#!/usr/bin/env bash
# heavy.sh <command...> -- runs a heavy job (build, test, typecheck, app launch) one at a time
# per machine, at low priority. Agents in parallel worktrees share one Mac; two builds plus a
# vitest fan-out at once pushed it into 13 GB of swap.
set -uo pipefail
[ $# -gt 0 ] || { echo "usage: heavy.sh <command...>" >&2; exit 2; }

# Test, typecheck and lint run in CI, not on the shared Mac (a lane ran a build, the app and a wide
# test:changed at once and froze a 16 GB Mac; lint alone takes about 2 min and 3.3 GB). Matched here,
# not flagged in package.json, because a package.json change makes vitest --changed rerun every test.
# One named test file stays allowed locally.
case "$*" in
  *run-vitest.mjs*|*run-typecheck-projects-in-parallel.mjs*|"sh -c oxlint "*)
    if [ "${CI:-}" != true ]; then
      files=0
      for arg in "$@"; do [[ "$arg" =~ \.(test|spec)\.[cm]?[jt]sx?$ ]] && files=$((files + 1)); done
      if [ "$files" -ne 1 ] || [[ "$*" != *run-vitest.mjs* ]]; then
        echo "heavy: refused locally. Push your branch; CI runs typecheck, lint and tests. Prove behavior with the verify skill's journeys (.claude/skills/verify/SKILL.md). One test file is allowed: pnpm test --project <project> <file>.test.ts" >&2
        exit 1
      fi
    fi ;;
esac

# One toolchain: package.json engines pins the node major, and Orca's native modules fail under another.
want="$(sed -n '/"engines"/,/}/s/.*"node": *"\([0-9]*\).*/\1/p' "$(dirname "$0")/../package.json")"
have="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
if [ "$have" != "$want" ]; then
  echo "heavy: node $have is on PATH, this repo needs node $want: export PATH=/opt/homebrew/opt/node@$want/bin:\$PATH" >&2
  exit 1
fi

# Nested calls (a build inside a test run) already hold the lock; CI runners are not shared.
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
