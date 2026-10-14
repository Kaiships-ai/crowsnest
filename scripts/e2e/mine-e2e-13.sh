#!/usr/bin/env bash
# mine-e2e-13 -- documents/architect/core-components/mine/04-test-cases.md, E2E-13.
#
# Publish with no token or bucket names what is missing and keeps the caption (seed: mine-seed.ts no-graph).
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

npx tsx scripts/e2e/mine-seed.ts no-graph
TODAY="$(date +%Y-%m-%d)"
CAPTION="E2E caption $$"

step "arrive: /?tab=calendar, open the plan's publish dialog"
goto_and_settle "$BASE_URL/?tab=calendar"
"$BROWSE" click "[data-testid=\"mine-calendar-day\"][data-id=\"$TODAY\"]"
"$BROWSE" click '[data-testid="mine-plan-open-publish"]'
"$BROWSE" wait '[data-testid="publish-dialog-not-configured"]'

step "assert: the missing settings are named, submit is disabled"
for v in IG_GRAPH_TOKEN IG_GRAPH_USER_ID S3_ENDPOINT S3_BUCKET S3_KEY S3_SECRET S3_PUBLIC_BASE; do assert_text "$v"; done
[ "$("$BROWSE" js "document.querySelector('[data-testid=\"publish-dialog-submit\"]').disabled" | tr -d '[:space:]')" = "true" ] || { echo "submit enabled" >&2; exit 1; }
echo "  ok: submit disabled"

step "act: type a caption, close, reopen"
"$BROWSE" fill '[data-testid="publish-dialog-caption"]' "$CAPTION"
"$BROWSE" click '[data-testid="publish-dialog-cancel"]'
"$BROWSE" wait --networkidle
sleep 0.5
"$BROWSE" click '[data-testid="mine-plan-open-publish"]'
"$BROWSE" wait '[data-testid="publish-dialog-caption"]'
GOT="$("$BROWSE" js "document.querySelector('[data-testid=\"publish-dialog-caption\"]').value")"
[[ "$GOT" == *"$CAPTION"* ]] || { echo "ASSERT FAILED: caption lost on reopen, got: $GOT" >&2; exit 1; }
echo "  ok: caption kept on reopen"
snap "not-configured"

echo "mine-e2e-13: PASS"
