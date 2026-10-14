#!/usr/bin/env bash
# mine-e2e-18 -- documents/architect/core-components/mine/04-test-cases.md, E2E-18.
#
# The views-over-time chart draws the reel against the typical reel.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/e2e/lib.sh

# count <selector> -- how many elements match, read through browse js.
count() { "$BROWSE" js "document.querySelectorAll('$1').length" | tr -d '[:space:]'; }
# expect_count <selector> <n>
expect_count() {
  local got
  got="$(count "$1")"
  [ "$got" = "$2" ] || { echo "ASSERT FAILED: expected $2 of $1, got $got" >&2; exit 1; }
  echo "  ok: $2 of $1"
}

npx tsx scripts/e2e/mine-seed.ts reels

step "arrive: /?tab=reels, pick reel A"
goto_and_settle "$BASE_URL/?tab=reels"
"$BROWSE" click '[data-testid="reels-picker-item"][data-id="reelA"]'
"$BROWSE" wait --networkidle
"$BROWSE" wait '[data-testid="reels-views-chart"]'
assert_text "Your typical reel"
snap "views-over-time"

echo "mine-e2e-18: PASS"
