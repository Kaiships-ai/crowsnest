#!/usr/bin/env bash
# mine-e2e-10 -- scripts/e2e/cases/mine.md, E2E-10.
#
# Delete a plan, then Undo, and the grid shows it again (seed: mine-seed.ts plan).
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

npx tsx scripts/e2e/mine-seed.ts plan
TODAY="$(date +%Y-%m-%d)"
CELL="[data-id=\"$TODAY\"] [data-testid=\"mine-calendar-scheduled\"]"

step "arrive: /?tab=calendar"
goto_and_settle "$BASE_URL/?tab=calendar"
wait_any "$CELL"
"$BROWSE" click "[data-testid=\"mine-calendar-day\"][data-id=\"$TODAY\"]"
"$BROWSE" wait '[data-testid="mine-plan-delete"]'

step "act: delete (no attached video, so no confirm dialog)"
"$BROWSE" click '[data-testid="mine-plan-delete"]'
"$BROWSE" wait '[data-testid="mine-delete-undo"]'
expect_count "$CELL" 0

step "act: Undo"
"$BROWSE" click '[data-testid="mine-delete-undo"]'
wait_any "$CELL"
expect_count "$CELL" 1
snap "undo-restored"

echo "mine-e2e-10: PASS"
