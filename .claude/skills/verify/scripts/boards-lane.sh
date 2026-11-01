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
# The fake sidecar checks no token; a set one spares the app the secret store, which Linux CI does not have.
export IG_SERVICE_TOKEN=boards-lane-fake
echo "boards: sidecar at $IG_SERVICE_URL"
rm -f "$DIR/fake-umami.port"
node .claude/skills/verify/scripts/fake-umami.mjs >"$DIR/fake-umami.log" 2>&1 &
echo $! >"$DIR/fake-umami.pid"
for _ in $(seq 1 50); do [ -s "$DIR/fake-umami.port" ] && break; sleep 0.1; done
[ -s "$DIR/fake-umami.port" ] || { echo "boards: fake Umami did not start, see $DIR/fake-umami.log" >&2; exit 1; }
echo "boards: Umami at http://127.0.0.1:$(cat "$DIR/fake-umami.port")"
rm -f "$DIR/fake-polar.port"
node .claude/skills/verify/scripts/fake-polar.mjs >"$DIR/fake-polar.log" 2>&1 &
echo $! >"$DIR/fake-polar.pid"
for _ in $(seq 1 50); do [ -s "$DIR/fake-polar.port" ] && break; sleep 0.1; done
[ -s "$DIR/fake-polar.port" ] || { echo "boards: fake Polar did not start, see $DIR/fake-polar.log" >&2; exit 1; }
export POLAR_API_URL="http://127.0.0.1:$(cat "$DIR/fake-polar.port")"
echo "boards: Polar at $POLAR_API_URL"
.claude/skills/verify/scripts/app-up.sh --seed
