#!/usr/bin/env bash
# mine-e2e-01 -- scripts/e2e/cases/mine.md, E2E-01.
#
# Mark a tracked channel as your own from the picker (seed: mine-seed.ts no-own).
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

npx tsx scripts/e2e/mine-seed.ts no-own

step "arrive: /?tab=reels renders the picker"
goto_and_settle "$BASE_URL/?tab=reels"
"$BROWSE" wait '[data-testid="own-channel-picker-choose"]'

step "act: This is me"
"$BROWSE" click '[data-testid="own-channel-picker-choose"]'
"$BROWSE" wait '[data-testid="mine-connect-panel"]'

step "assert: the picker is gone, still on My reels"
expect_count '[data-testid="own-channel-picker-choose"]' 0
assert_url_contains "tab=reels"
snap "picker-left"

echo "mine-e2e-01: PASS"
