#!/usr/bin/env bash
# mine-e2e-05 -- documents/architect/core-components/mine/04-test-cases.md, E2E-05.
#
# Browse own posts, then the weekday chart (seed: mine-seed.ts reels).
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
wait_any '[data-testid="mine-post-row"]'

step "assert: the four seeded posts list, and the weekday chart draws bars"
expect_count '[data-testid="mine-post-row"]' 4
wait_any '[data-testid="mine-weekday-bar"]'
"$BROWSE" js "document.querySelector('[data-testid=\"mine-weekday-bar\"]').scrollIntoView({block:'center'})" >/dev/null
snap "weekday-bars"

echo "mine-e2e-05: PASS"
