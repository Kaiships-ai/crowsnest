#!/usr/bin/env bash
# run-all.sh [run-id] -- every Lead Studio journey in dev mode, each on the lane it needs, then one
# HTML report: data/verify/evidence/<run-id>/report.html. Exits 1 when any journey failed.
#   1. baseline-lane.sh --compare: stopped clock, its board journeys in order, then gate2-01 on the fake Graph
#   2. boards-lane.sh: every other journey (fake sidecar and Umami)
#   3. fresh-lane.sh: fresh-01 with no project open
#   4. schedule-lane.sh: schedule-01 on the fake Graph and a clock at 04:59:30
#   5. card-state-lane.sh: card-state-01, an app restart on the same DB, then card-state-02
#   6. graph-lane.sh: graph-pull-01 on the fake Graph
#   7. crash-rest-lane.sh: crash-rest-01, a quit mid pull, then crash-rest-02 on the DB copied mid pull
set -uo pipefail
cd "$(dirname "$0")/../../../.."
S=.claude/skills/verify/scripts
RUN="${1:-all-$(date +%Y%m%dT%H%M%S)}"
OUT="data/verify/evidence/$RUN"
mkdir -p "$OUT"
export APP_DEV=1 APP_HEADLESS="${APP_HEADLESS:-1}"

drive() { "$S/app-drive.sh" "$1" "$RUN" >"$OUT/$1.out" 2>&1; echo $? >"$OUT/$1.rc"; }
lane() { # lane <journey> <script>: a lane script that runs one journey itself
  "$S/$2" "$RUN" >"$OUT/$1.out" 2>&1; echo $? >"$OUT/$1.rc"; "$S/app-down.sh" >/dev/null
}

RUN="$RUN" "$S/baseline-lane.sh" --compare >"$OUT/lane-baseline.out" 2>&1; echo $? >"$OUT/baseline-compare.rc"; cp "$OUT/lane-baseline.out" "$OUT/baseline-compare.out"
"$S/app-down.sh" >/dev/null

# Orca's own workspace journeys (shell-01, close-terminal) stay out: run-all checks Lead Studio code.
journeys=$(ls "$S/app-journeys" | sed -n 's/\.mjs$//p' | grep -vxE 'shell-01|close-terminal|schedule-01|fresh-01|card-state-01|card-state-02|graph-pull-01|crash-rest-01|crash-rest-02|crash-rest-common')
rest=$(for j in $journeys; do [ -f "$OUT/$j.rc" ] || echo "$j"; done)
if "$S/boards-lane.sh" >"$OUT/lane-boards.out" 2>&1; then
  for j in $rest; do drive "$j"; done
else
  echo "run-all: boards lane did not start, see $OUT/lane-boards.out" >&2
  for j in $rest; do echo 1 >"$OUT/$j.rc"; cp "$OUT/lane-boards.out" "$OUT/$j.out"; done
fi
"$S/app-down.sh" >/dev/null

lane fresh-01 fresh-lane.sh
lane schedule-01 schedule-lane.sh
lane card-state-02 card-state-lane.sh
lane graph-pull-01 graph-lane.sh
lane crash-rest-02 crash-rest-lane.sh

for f in "$OUT"/*.rc; do j=$(basename "$f" .rc); echo "run-all: $j $( [ "$(cat "$f")" = 0 ] && echo ok || echo FAIL)"; done
node "$S/run-all-report.mjs" "$OUT"
"$S/keep-evidence.sh" >/dev/null
! grep -qv '^0$' "$OUT"/*.rc
