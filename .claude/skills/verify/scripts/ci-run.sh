#!/usr/bin/env bash
# ci-run.sh <run-id> <journey>... -- verify.yml's run, on an X display (Xvfb in CI): records the X display with ffmpeg,
# starts the boards lane in dev mode (fakes only), drives each journey, and writes summary.md beside the
# evidence in data/verify/evidence/<run-id>/. Exits 1 when the lane or any journey failed.
set -uo pipefail
cd "$(dirname "$0")/../../../.."
S=.claude/skills/verify/scripts
RUN="$1"; shift
OUT="data/verify/evidence/$RUN"
mkdir -p "$OUT"
export APP_DEV=1 BASELINE_SKIP=1

# Video only on Linux (x11grab); the macOS runner has no screen-recording grant, so it keeps screenshots only.
FF=
if [ "$(uname)" = Linux ]; then
  ffmpeg -loglevel error -y -f x11grab -framerate 10 -video_size 1440x900 -i "$DISPLAY" \
    -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$OUT/run.mp4" </dev/null &
  FF=$!
fi

rc=0
{ echo "| Journey | Result |"; echo "|---|---|"; } >"$OUT/summary.md"
if "$S/boards-lane.sh" >"$OUT/lane-boards.out" 2>&1; then
  for j in "$@"; do
    if "$S/app-drive.sh" "$j" "$RUN" >"$OUT/$j.out" 2>&1; then r=ok; else r=FAIL; rc=1; fi
    [ "$r" = ok ] && grep -q '^skip: ' "$OUT/$j.out" && r="skipped: $(sed -n 's/^skip: //p' "$OUT/$j.out")"
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
[ -n "$FF" ] && { kill -INT "$FF" 2>/dev/null; wait "$FF" 2>/dev/null; }
exit $rc
