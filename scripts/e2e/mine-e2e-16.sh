#!/usr/bin/env bash
# mine-e2e-16 -- documents/architect/core-components/mine/04-test-cases.md, E2E-16.
#
# Picking a reel puts it in ?reel=, and a reload keeps it selected.
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

step "arrive: /?tab=reels"
goto_and_settle "$BASE_URL/?tab=reels"
expect_count '[data-testid="reels-picker-item"]' 3
step "act: pick reel B"
"$BROWSE" click '[data-testid="reels-picker-item"][data-id="reelB"]'
"$BROWSE" wait --networkidle
assert_url_contains "reel=reelB"
step "act: reload"
goto_and_settle "$("$BROWSE" url)"
assert_url_contains "reel=reelB"
"$BROWSE" wait '[data-testid="reels-picker-item"][data-id="reelB"][aria-current="true"]'
wait_any '[data-testid="reels-summary-tile"]'
snap "reel-b-selected"

echo "mine-e2e-16: PASS"
