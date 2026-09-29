#!/usr/bin/env bash
# mine-e2e-19 -- documents/architect/core-components/mine/04-test-cases.md, E2E-19.
#
# Follower split and audience blocks are labelled whole-account; each audience tab opens.
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
"$BROWSE" wait '[data-testid="reels-follower-split"]'
for d in age country gender; do
  step "act: audience tab $d"
  "$BROWSE" click "[data-testid=\"reels-audience-tab-$d\"]"
  assert_text "Whole account, not this reel"
done
snap "audience"

echo "mine-e2e-19: PASS"
