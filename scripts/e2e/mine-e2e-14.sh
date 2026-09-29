#!/usr/bin/env bash
# mine-e2e-14 -- documents/architect/core-components/mine/04-test-cases.md, E2E-14.
#
# Moving between the three Dashboard tabs keeps the tab in the URL, across a reload.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/e2e/lib.sh

# count <selector> -- how many elements match, read through browse js.
count() { "$BROWSE" js "document.querySelectorAll('$1').length" | tr -d '[:space:]'; }

step "arrive: /"
goto_and_settle "$BASE_URL/"
step "act: My reels tab, then reload"
"$BROWSE" click '[data-testid="dashboard-tab-reels"]'
"$BROWSE" wait --networkidle
assert_url_contains "tab=reels"
goto_and_settle "$("$BROWSE" url)"
assert_url_contains "tab=reels"
step "act: Calendar tab"
"$BROWSE" click '[data-testid="dashboard-tab-calendar"]'
wait_any '[data-testid="mine-calendar-day"]'
assert_url_contains "tab=calendar"
step "act: Overview tab"
"$BROWSE" click '[data-testid="dashboard-tab-overview"]'
"$BROWSE" wait --networkidle
assert_url_contains "tab=overview"
[ "$(count '[data-testid="mine-calendar-day"]')" = "0" ] || { echo "calendar still rendered on Overview" >&2; exit 1; }
snap "overview"

echo "mine-e2e-14: PASS"
