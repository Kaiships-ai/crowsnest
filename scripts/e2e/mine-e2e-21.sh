#!/usr/bin/env bash
# mine-e2e-21 -- scripts/e2e/cases/mine.md, E2E-21.
#
# A bad ?tab= falls back to Overview; a ?reel= that is no reel says so instead of erroring:
# an unknown id reads as not measured yet, a non-reel own post links to Instagram.
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
wait_any '[data-testid="reels-unmeasured-link"]'
expect_count '[data-testid="reels-picker-item"]' 3
expect_count '[data-testid="reels-summary-tile"]' 0
"$BROWSE" js "document.querySelector('[data-testid=\"reels-unmeasured-link\"]').scrollIntoView({block:'center'})" >/dev/null
snap "unmeasured-link"
step "arrive: /?tab=reels&reel=carousel (a calendar link to a non-reel post)"
goto_and_settle "$BASE_URL/?tab=reels&reel=carousel"
wait_any '[data-testid="reels-not-a-reel"]'
expect_count '[data-testid="reels-unmeasured-link"]' 0
assert_text "Open it on Instagram"
"$BROWSE" js "document.querySelector('[data-testid=\"reels-not-a-reel\"]').scrollIntoView({block:'center'})" >/dev/null
snap "not-a-reel"

echo "mine-e2e-21: PASS"
