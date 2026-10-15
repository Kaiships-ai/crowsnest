#!/usr/bin/env bash
# mine-e2e-11 -- scripts/e2e/cases/mine.md, E2E-11.
#
# Only the newest 100 own posts load (seed: mine-seed.ts posts-101).
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

npx tsx scripts/e2e/mine-seed.ts posts-101

step "arrive: /?tab=reels"
goto_and_settle "$BASE_URL/?tab=reels"
wait_any '[data-testid="mine-post-row"]'

step "assert: 100 rows, the oldest (Fixture p100) absent"
expect_count '[data-testid="mine-post-row"]' 100
HAS_OLDEST="$("$BROWSE" js "document.body.innerText.includes('Fixture p100')" | tr -d '[:space:]')"
[ "$HAS_OLDEST" = "false" ] || { echo "the 101st post rendered" >&2; exit 1; }
echo "  ok: the 101st post is absent"
"$BROWSE" js "document.querySelectorAll('[data-testid=\"mine-post-row\"]')[99].scrollIntoView({block:'center'})" >/dev/null
snap "hundred-rows"

echo "mine-e2e-11: PASS"
