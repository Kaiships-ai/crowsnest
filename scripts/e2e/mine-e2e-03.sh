#!/usr/bin/env bash
# mine-e2e-03 -- documents/architect/core-components/mine/04-test-cases.md, E2E-03.
#
# Mark a plan published from the day panel, then the cell shows it (seed: mine-seed.ts plan).
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

step "arrive: /?tab=calendar"
goto_and_settle "$BASE_URL/?tab=calendar"
"$BROWSE" click "[data-testid=\"mine-calendar-day\"][data-id=\"$TODAY\"]"
"$BROWSE" wait '[data-testid="mine-calendar-mark-published"]'

step "act: mark published, no post linked"
"$BROWSE" click '[data-testid="mine-calendar-mark-published"]'
assert_text "Marked published, no post linked"
wait_any '[data-testid="mine-calendar-published"]'

step "assert: the day reads published, not failed"
expect_count "[data-id=\"$TODAY\"] [data-testid=\"mine-calendar-published\"]" 1
expect_count '[data-testid="mine-calendar-failed"]' 0
snap "published-cell"

echo "mine-e2e-03: PASS"
