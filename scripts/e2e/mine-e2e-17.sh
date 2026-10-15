#!/usr/bin/env bash
# mine-e2e-17 -- scripts/e2e/cases/mine.md, E2E-17.
#
# One reel's insight blocks, in the app's order, with per-viewer rates and the estimated skip rate.
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
assert_url_contains "reel=reelA"
step "assert: block counts"
expect_count '[data-testid="reels-summary-tile"]' 4
expect_count '[data-testid="reels-interaction"]' 5
expect_count '[data-testid="reels-impact-row"]' 6
expect_count '[data-testid="reels-action-row"]' 3
expect_count '[data-testid="reels-unavailable"]' 3
expect_count '[data-testid="reels-measured-at"]' 1
assert_text "estimated"
assert_text "1.4%"
snap "reel-a-insights"

echo "mine-e2e-17: PASS"
