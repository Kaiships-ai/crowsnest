#!/usr/bin/env bash
# mine-e2e-23 -- documents/architect/core-components/mine/04-test-cases.md, E2E-23.
#
# Reach 0 renders every derived rate as a dash, never 0%.
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

npx tsx scripts/e2e/mine-seed.ts reach-zero

step "arrive: /?tab=reels, pick the reel"
goto_and_settle "$BASE_URL/?tab=reels"
"$BROWSE" click '[data-testid="reels-picker-item"][data-id="rz"]'
"$BROWSE" wait --networkidle
wait_any '[data-testid="reels-impact-row"]'
OK="$("$BROWSE" js "[...document.querySelectorAll('[data-testid=\"reels-impact-row\"]')].slice(1).every((r) => r.textContent.includes('—') && !r.textContent.includes('0%'))" | tr -d '[:space:]')"
[ "$OK" = "true" ] || { echo "a derived rate is not a dash ($OK)" >&2; exit 1; }
echo "  ok: every derived rate is a dash"
snap "reach-zero"

echo "mine-e2e-23: PASS"
