#!/usr/bin/env bash
# mine-e2e-22 -- documents/architect/core-components/mine/04-test-cases.md, E2E-22.
#
# No reels: the picker says so, and the post list still shows the carousel.
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

npx tsx scripts/e2e/mine-seed.ts no-reels

step "arrive: /?tab=reels"
goto_and_settle "$BASE_URL/?tab=reels"
expect_count '[data-testid="reels-picker-item"]' 0
expect_count '[data-testid="reels-summary-tile"]' 0
assert_text "No reels measured yet"
[ "$(count '[data-testid="mine-post-row"]')" -ge 1 ] || { echo "expected at least one post row" >&2; exit 1; }
echo "  ok: the carousel is in the post list"
snap "no-reels"

echo "mine-e2e-22: PASS"
