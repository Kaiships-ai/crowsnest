#!/usr/bin/env bash
# drive.sh <journey-name> [run-id] -- runs scripts/e2e/<journey>.sh against the verify
# instance, saving the transcript and screenshots under data/verify/evidence/<run-id>/.
set -uo pipefail
cd "$(dirname "$0")/../../../.."
J="${1:?usage: drive.sh <journey, e.g. feed-e2e-01> [run-id]}"
RUN="${2:-$(date +%Y%m%d-%H%M%S)}"
PORT="$(cat data/verify/server.port 2>/dev/null || echo 3001)"
OUT="data/verify/evidence/$RUN"
mkdir -p "$OUT"
BASE_URL="http://localhost:$PORT" SNAP_DIR="$OUT" bash "scripts/e2e/$J.sh" 2>&1 | tee "$OUT/$J.transcript.txt"
rc=${PIPESTATUS[0]}
echo "verify: $J exit=$rc, evidence in $OUT"
exit "$rc"
