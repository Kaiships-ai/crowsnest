#!/usr/bin/env bash
# mine-e2e-08 -- documents/architect/core-components/mine/04-test-cases.md, E2E-08.
#
# A rejected token stacks the connect panel over the measured numbers (seed: mine-seed.ts reels, junk token).
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
"$BROWSE" wait '[data-testid="mine-connect-panel"]'
wait_any '[data-testid="mine-stat-tile"]'

step "assert: the panel sits above the stat tiles"
ABOVE="$("$BROWSE" js "!!(document.querySelector('[data-testid=\"mine-connect-panel\"]').compareDocumentPosition(document.querySelector('[data-testid=\"mine-stat-tile\"]')) & Node.DOCUMENT_POSITION_FOLLOWING)" | tr -d '[:space:]')"
[ "$ABOVE" = "true" ] || { echo "connect panel is not above the tiles ($ABOVE)" >&2; exit 1; }
echo "  ok: connect panel above the tiles"
assert_text "42,000"
snap "panel-over-tiles"

echo "mine-e2e-08: PASS"
