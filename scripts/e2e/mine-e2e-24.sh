#!/usr/bin/env bash
# mine-e2e-24 -- documents/architect/core-components/mine/04-test-cases.md, E2E-24.
#
# Below the engagement threshold, the audience block explains why it is empty.
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

npx tsx scripts/e2e/mine-seed.ts audience-refused

step "arrive: /?tab=reels"
goto_and_settle "$BASE_URL/?tab=reels"
"$BROWSE" click '[data-testid="reels-audience-tab-age"]'
assert_text "100 or more engagements"
snap "audience-threshold"

echo "mine-e2e-24: PASS"
