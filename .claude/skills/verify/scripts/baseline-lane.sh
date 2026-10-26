#!/usr/bin/env bash
# The Lead Studio v2 visual baseline: a fixed seed on a stopped clock, no jobs, no outside calls.
set -euo pipefail
cd "$(dirname "$0")/../../../.."
export LEAD_STUDIO_CLOCK_START="2026-10-27T10:30:00"
export LEAD_STUDIO_CLOCK_FROZEN=1
export LEAD_STUDIO_READ_JOBS=0
# Port 9 (discard) refuses at once, so a stray Graph or sidecar call fails on this Mac instead of leaving it.
export IG_GRAPH_HOST="http://127.0.0.1:9"
export IG_SERVICE_URL="http://127.0.0.1:9"
export APP_HEADLESS="${APP_HEADLESS:-1}"
echo "baseline: clock stopped at $LEAD_STUDIO_CLOCK_START, read jobs off"
.claude/skills/verify/scripts/app-up.sh --seed
.claude/skills/verify/scripts/app-drive.sh baseline-v2 "${1:-baseline-v2}"
