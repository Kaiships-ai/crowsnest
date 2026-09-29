#!/usr/bin/env bash
# mine-e2e-15 -- documents/architect/core-components/mine/04-test-cases.md, E2E-15.
#
# An old /mine link lands on the Calendar tab with its month, and month controls keep the tab.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/e2e/lib.sh

step "arrive: old /mine link with a month"
goto_and_settle "$BASE_URL/mine?month=2026-08"
assert_url_contains "tab=calendar"
assert_url_contains "month=2026-08"
"$BROWSE" wait '[data-testid="mine-calendar-day"][data-id="2026-08-15"]'
step "act: next month"
"$BROWSE" click 'a[aria-label="Next month"]'
"$BROWSE" wait --networkidle
assert_url_contains "tab=calendar"
assert_url_contains "month=2026-09"
step "act: previous month"
"$BROWSE" click 'a[aria-label="Previous month"]'
"$BROWSE" wait --networkidle
assert_url_contains "tab=calendar"
assert_url_contains "month=2026-08"
snap "calendar-august"

echo "mine-e2e-15: PASS"
