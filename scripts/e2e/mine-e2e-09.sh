#!/usr/bin/env bash
# mine-e2e-09 -- scripts/e2e/cases/mine.md, E2E-09.
#
# A whitespace-only plan title keeps Save disabled (seed: mine-seed.ts empty).
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
TODAY="$(date +%Y-%m-%d)"
disabled() { "$BROWSE" js "document.querySelector('[data-testid=\"plan-dialog-save\"]').disabled" | tr -d '[:space:]'; }

step "arrive: /?tab=calendar, open the plan dialog on an empty day"
goto_and_settle "$BASE_URL/?tab=calendar"
"$BROWSE" click "[data-testid=\"mine-calendar-day\"][data-id=\"$TODAY\"]"
"$BROWSE" click '[data-testid="mine-calendar-plan-day"]'
"$BROWSE" wait '[data-testid="plan-dialog-title"]'
"$BROWSE" click '[data-testid="plan-dialog-no-script-ack"]'

step "act: a real title enables Save"
"$BROWSE" fill '[data-testid="plan-dialog-title"]' "Real title"
[ "$(disabled)" = "false" ] || { echo "Save stayed disabled with a real title" >&2; exit 1; }
echo "  ok: Save enabled"

step "act: spaces only disables it again"
"$BROWSE" fill '[data-testid="plan-dialog-title"]' "   "
[ "$(disabled)" = "true" ] || { echo "Save enabled on a blank title" >&2; exit 1; }
echo "  ok: Save disabled"
snap "save-disabled"

echo "mine-e2e-09: PASS"
