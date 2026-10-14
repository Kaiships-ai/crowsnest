#!/usr/bin/env bash
# mine-e2e-07 -- scripts/e2e/cases/mine.md, E2E-07.
#
# Zero-data state across posts, metrics, and the calendar (seed: mine-seed.ts empty).
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

npx tsx scripts/e2e/mine-seed.ts empty

step "arrive: /?tab=reels"
goto_and_settle "$BASE_URL/?tab=reels"
assert_text "No posts synced from Instagram yet."
assert_text "No measured posts yet to read a weekday rhythm from."
"$BROWSE" js "[...document.querySelectorAll('h3')].find((h) => h.textContent === 'Posts').scrollIntoView({block:'start'})" >/dev/null
snap "reels-empty"

step "act: open the Calendar tab"
"$BROWSE" click '[data-testid="dashboard-tab-calendar"]'
assert_url_contains "tab=calendar"
wait_any '[data-testid="mine-calendar-day"]'
expect_count '[data-testid="mine-calendar-scheduled"]' 0
expect_count '[data-testid="mine-calendar-published"]' 0
snap "calendar-empty"

echo "mine-e2e-07: PASS"
