#!/usr/bin/env bash
# Lead Studio v2 run-all: one app on a fixed seed and a stopped clock, the baseline shots
# with their DoD checks, then the board journeys. --compare shoots to data/verify/baseline-new
# and diffs it against the approved baseline instead of writing the approved one.
set -euo pipefail
cd "$(dirname "$0")/../../../.."
S=.claude/skills/verify/scripts
DIR=data/verify/app
APPROVED="${BASELINE_APPROVED:-$HOME/.claude/orchestrate/lead-studio-v2/baseline}"
mkdir -p "$DIR"
start_fake() {
  rm -f "$DIR/$1.port"
  node "$S/$1.mjs" >"$DIR/$1.log" 2>&1 &
  echo $! >"$DIR/$1.pid"
  for _ in $(seq 1 50); do [ -s "$DIR/$1.port" ] && return 0; sleep 0.1; done
  echo "baseline: $1 did not start, see $DIR/$1.log" >&2
  exit 1
}
start_fake fake-sidecar
start_fake fake-umami
export IG_SERVICE_URL="http://127.0.0.1:$(cat "$DIR/fake-sidecar.port")"
# Port 9 (discard) refuses at once, so a stray Graph call fails on this Mac instead of leaving it.
export IG_GRAPH_HOST="http://127.0.0.1:9"
export LEAD_STUDIO_CLOCK_START="2026-10-27T10:30:00"
export LEAD_STUDIO_CLOCK_FROZEN=1
export LEAD_STUDIO_READ_JOBS=0
export APP_HEADLESS="${APP_HEADLESS:-1}"
export APP_DEV="${APP_DEV:-1}"
if [ "${1:-}" = --compare ]; then
  export BASELINE_DIR="$PWD/data/verify/baseline-new"
  rm -rf "$BASELINE_DIR"
fi
echo "baseline: clock stopped at $LEAD_STUDIO_CLOCK_START, read jobs off, shots to ${BASELINE_DIR:-$APPROVED}"
"$S/app-up.sh" --seed
RUN="baseline-$(date +%Y%m%d-%H%M%S)"
rc=0
for journey in baseline-v2 today-01 funnel-01 own-01 plan-01 cook-01 rivals-01 agents-01 sources-01 umami-01; do
  "$S/app-drive.sh" "$journey" "$RUN" || rc=1
done
if [ "${1:-}" = --compare ]; then
  node "$S/baseline-diff.mjs" "$APPROVED" "$BASELINE_DIR" || rc=1
fi
exit $rc
