#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
DIR=data/verify/app
mkdir -p "$DIR"
rm -f "$DIR/fake-sidecar.port"
node .claude/skills/verify/scripts/fake-sidecar.mjs >"$DIR/fake-sidecar.log" 2>&1 &
echo $! >"$DIR/fake-sidecar.pid"
for _ in $(seq 1 50); do [ -s "$DIR/fake-sidecar.port" ] && break; sleep 0.1; done
[ -s "$DIR/fake-sidecar.port" ] || { echo "boards: fake sidecar did not start, see $DIR/fake-sidecar.log" >&2; exit 1; }
export IG_SERVICE_URL="http://127.0.0.1:$(cat "$DIR/fake-sidecar.port")"
echo "boards: sidecar at $IG_SERVICE_URL"
.claude/skills/verify/scripts/app-up.sh --seed
