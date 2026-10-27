#!/usr/bin/env bash
# Gate 2 lane: one app on the fixed seed and the stopped clock, with the fake Graph doubling as
# the S3 bucket and dry run off, so an approved publish runs every Graph call against the fake.
# The real Graph and the real bucket are never reachable from this lane.
set -euo pipefail
cd "$(dirname "$0")/../../../.."
S=.claude/skills/verify/scripts
DIR=data/verify/app
mkdir -p "$DIR"
rm -f "$DIR/fake-graph.port"
node "$S/fake-graph.mjs" >"$DIR/fake-graph.log" 2>&1 &
echo $! >"$DIR/fake-graph.pid"
for _ in $(seq 1 50); do [ -s "$DIR/fake-graph.port" ] && break; sleep 0.1; done
[ -s "$DIR/fake-graph.port" ] || { echo "gate2: fake Graph did not start, see $DIR/fake-graph.log" >&2; exit 1; }
FAKE="http://127.0.0.1:$(cat "$DIR/fake-graph.port")"
export IG_GRAPH_HOST="$FAKE"
export S3_ENDPOINT="$FAKE" S3_BUCKET=bucket S3_KEY=fake-key S3_SECRET=fake-secret S3_PUBLIC_BASE="$FAKE/public"
export PUBLISH_DRY_RUN=0
export LEAD_STUDIO_CLOCK_START="2026-10-27T10:30:00"
export LEAD_STUDIO_CLOCK_FROZEN=1
export APP_HEADLESS="${APP_HEADLESS:-1}"
export APP_DEV="${APP_DEV:-1}"
echo "gate2: Graph and bucket at $FAKE, clock stopped at $LEAD_STUDIO_CLOCK_START"
"$S/app-up.sh" --seed
"$S/app-drive.sh" gate2-01 "${1:-gate2}"
