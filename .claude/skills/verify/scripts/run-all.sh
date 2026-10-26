#!/usr/bin/env bash
# run-all.sh [run-id] -- every Lead Studio journey in one dev-mode app session (the boards lane's fake
# sidecar and Umami), then schedule-01 in its own clock lane, then one HTML report:
# data/verify/evidence/<run-id>/report.html. Exits 1 when any journey failed.
set -uo pipefail
cd "$(dirname "$0")/../../../.."
S=.claude/skills/verify/scripts
RUN="${1:-all-$(date +%Y%m%dT%H%M%S)}"
OUT="data/verify/evidence/$RUN"
mkdir -p "$OUT"
export APP_DEV=1 APP_HEADLESS="${APP_HEADLESS:-1}"

# Orca's own workspace journeys (shell-01, close-terminal) stay out: run-all checks Lead Studio code.
journeys=$(ls "$S/app-journeys" | sed -n 's/\.mjs$//p' | grep -vxE 'shell-01|close-terminal|schedule-01')

drive() { "$S/app-drive.sh" "$1" "$RUN" >"$OUT/$1.out" 2>&1; echo $? >"$OUT/$1.rc"; echo "run-all: $1 $( [ "$(cat "$OUT/$1.rc")" = 0 ] && echo ok || echo FAIL)"; }

if "$S/boards-lane.sh" >"$OUT/lane-boards.out" 2>&1; then
  for j in $journeys; do drive "$j"; done
else
  echo "run-all: boards lane did not start, see $OUT/lane-boards.out" >&2
  for j in $journeys; do echo 1 >"$OUT/$j.rc"; cp "$OUT/lane-boards.out" "$OUT/$j.out"; done
fi
"$S/app-down.sh" >/dev/null

"$S/schedule-lane.sh" "$RUN" >"$OUT/schedule-01.out" 2>&1; echo $? >"$OUT/schedule-01.rc"
echo "run-all: schedule-01 $( [ "$(cat "$OUT/schedule-01.rc")" = 0 ] && echo ok || echo FAIL)"
"$S/app-down.sh" >/dev/null

node "$S/run-all-report.mjs" "$OUT"
"$S/keep-evidence.sh" >/dev/null
! grep -qv '^0$' "$OUT"/*.rc
