#!/usr/bin/env bash
# mine-e2e-21 -- documents/architect/core-components/mine/04-test-cases.md, E2E-21.
#
# A bad ?tab= falls back to Overview; a bad ?reel= falls back to the newest reel.
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

step "arrive: /?tab=nonsense"
goto_and_settle "$BASE_URL/?tab=nonsense"
"$BROWSE" wait '[data-testid="dashboard-tab-overview"][aria-current="page"]'
expect_count '[data-testid="reels-picker-item"]' 0
step "arrive: /?tab=reels&reel=does-not-exist"
goto_and_settle "$BASE_URL/?tab=reels&reel=does-not-exist"
"$BROWSE" wait '[data-testid="reels-picker-item"][data-id="reelA"][aria-current="true"]'
wait_any '[data-testid="reels-summary-tile"]'
snap "fallback-newest"

echo "mine-e2e-21: PASS"
