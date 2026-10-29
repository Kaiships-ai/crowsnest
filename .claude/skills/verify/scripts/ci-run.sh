#!/usr/bin/env bash
# ci-run.sh <run-id> <journey>... -- verify.yml's run, inside xvfb-run: records the X display with ffmpeg,
# starts the boards lane in dev mode (fakes only), drives each journey, and writes summary.md beside the
# evidence in data/verify/evidence/<run-id>/. Exits 1 when the lane or any journey failed.
set -uo pipefail
cd "$(dirname "$0")/../../../.."
S=.claude/skills/verify/scripts
RUN="$1"; shift
OUT="data/verify/evidence/$RUN"
mkdir -p "$OUT"
export APP_DEV=1 BASELINE_SKIP=1

ffmpeg -loglevel error -y -f x11grab -framerate 10 -video_size 1440x900 -i "$DISPLAY" \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$OUT/run.mp4" </dev/null &
FF=$!

rc=0
{ echo "| Journey | Result |"; echo "|---|---|"; } >"$OUT/summary.md"
if "$S/boards-lane.sh" >"$OUT/lane-boards.out" 2>&1; then
  for j in "$@"; do
    if "$S/app-drive.sh" "$j" "$RUN" >"$OUT/$j.out" 2>&1; then r=ok; else r=FAIL; rc=1; fi
    echo "| \`$j\` | $r |" >>"$OUT/summary.md"
    echo "ci: $j $r"
  done
else
  rc=1
  echo "| boards lane | FAIL, see lane-boards.out |" >>"$OUT/summary.md"
  tail -40 "$OUT/lane-boards.out"
fi
cp data/verify/app/*.log "$OUT/" 2>/dev/null
"$S/app-down.sh" >/dev/null
kill -INT "$FF" 2>/dev/null; wait "$FF" 2>/dev/null
exit $rc
