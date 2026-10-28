#!/usr/bin/env bash
# graph-lane.sh [run-id] -- graph-pull-01 on a seeded app whose Graph is the fake Graph.
set -euo pipefail
cd "$(dirname "$0")/../../../.."
S=.claude/skills/verify/scripts
DIR=data/verify/app
mkdir -p "$DIR"
rm -f "$DIR/fake-graph.port"
node "$S/fake-graph.mjs" >"$DIR/fake-graph.log" 2>&1 &
echo $! >"$DIR/fake-graph.pid"
for _ in $(seq 1 50); do [ -s "$DIR/fake-graph.port" ] && break; sleep 0.1; done
[ -s "$DIR/fake-graph.port" ] || { echo "graph: fake Graph did not start, see $DIR/fake-graph.log" >&2; exit 1; }
export IG_GRAPH_HOST="http://127.0.0.1:$(cat "$DIR/fake-graph.port")"
export APP_DEV="${APP_DEV:-1}"
echo "graph: Graph at $IG_GRAPH_HOST"
"$S/app-up.sh" --seed
"$S/app-drive.sh" graph-pull-01 "${1:-graph}"
