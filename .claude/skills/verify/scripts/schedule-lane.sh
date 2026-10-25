#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
DIR=data/verify/app
mkdir -p "$DIR"
rm -f "$DIR/fake-graph.port"
node .claude/skills/verify/scripts/fake-graph.mjs >"$DIR/fake-graph.log" 2>&1 &
echo $! >"$DIR/fake-graph.pid"
for _ in $(seq 1 50); do [ -s "$DIR/fake-graph.port" ] && break; sleep 0.1; done
[ -s "$DIR/fake-graph.port" ] || { echo "schedule: fake Graph did not start, see $DIR/fake-graph.log" >&2; exit 1; }
export IG_GRAPH_HOST="http://127.0.0.1:$(cat "$DIR/fake-graph.port")"
export LEAD_STUDIO_CLOCK_START="$(date +%Y-%m-%dT04:59:30)"
echo "schedule: Graph at $IG_GRAPH_HOST, app clock starts at $LEAD_STUDIO_CLOCK_START"
.claude/skills/verify/scripts/app-up.sh --seed
.claude/skills/verify/scripts/app-drive.sh schedule-01 "${1:-schedule}"
