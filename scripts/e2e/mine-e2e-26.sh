#!/usr/bin/env bash
# mine-e2e-26 -- documents/architect/core-components/mine/04-test-cases.md, E2E-26.
#
# Clicking the active Calendar tab again changes nothing: same URL, one strip, same grid.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/e2e/lib.sh

# count <selector> -- how many elements match, read through browse js.
count() { "$BROWSE" js "document.querySelectorAll('$1').length" | tr -d '[:space:]'; }

step "arrive: /?tab=calendar"
goto_and_settle "$BASE_URL/?tab=calendar"
wait_any '[data-testid="mine-calendar-day"]'
DAYS="$(count '[data-testid="mine-calendar-day"]')"
step "act: click the active Calendar tab twice"
for _ in 1 2; do
  "$BROWSE" click '[data-testid="dashboard-tab-calendar"]'
  "$BROWSE" wait --networkidle
done
assert_url_contains "tab=calendar"
[ "$(count '[data-testid="dashboard-tab-calendar"]')" = "1" ] || { echo "expected exactly one Calendar tab" >&2; exit 1; }
[ "$(count '[data-testid="mine-calendar-day"]')" = "$DAYS" ] || { echo "day count changed" >&2; exit 1; }
snap "calendar-stable"

echo "mine-e2e-26: PASS"
