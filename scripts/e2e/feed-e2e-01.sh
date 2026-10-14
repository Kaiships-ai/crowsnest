#!/usr/bin/env bash
# feed-e2e-01 -- scripts/e2e/cases/feed.md, E2E-01.
#
# Filter the feed to 5x+, open a card, move to the full detail page, keep the post --
# all through the real UI, checking the same filter slice carries end to end.
#
# Arrive: /feed, seeded with exactly one video scoring 5x+ (scripts/seed-e2e.ts).
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/e2e/lib.sh

step "arrive: open /feed"
goto_and_settle "$BASE_URL/feed"
# A bare /feed applies the High Conviction default (minScore 10), and the fixture's one
# outlier is 6.4x -- below that bar, so this can land on the "clears no bar yet" empty
# state rather than a result grid. That's expected and fine: the filter bar itself
# renders in every state (page.tsx renders it ahead of the empty-state branches), which
# is all this step needs before picking 5x+ below.
"$BROWSE" wait '[data-testid="feed-filter-min-score"]'

step "act: pick 5x+ from the score control"
"$BROWSE" click '[data-testid="feed-filter-min-score"]'
sleep 0.3
select_option_by_text "5×+ score"
"$BROWSE" wait --networkidle
assert_url_contains "minScore=5"

step "act: click the outlier card"
"$BROWSE" wait '[data-testid="outlier-card"]'
"$BROWSE" click '[data-testid="outlier-card"]'
"$BROWSE" wait '[data-testid="preview-open-full-page"]'
assert_text "Open full page"

step "act: open the full detail page"
"$BROWSE" click '[data-testid="preview-open-full-page"]'
"$BROWSE" wait --networkidle
assert_url_contains "/feed/"
assert_url_contains "minScore=5"

step "act: keep this post"
"$BROWSE" wait '[data-testid="save-post-button"]'
"$BROWSE" click '[data-testid="save-post-button"]'
"$BROWSE" wait '[data-testid="save-post-confirm"]'
assert_text "Keep this post"
"$BROWSE" click '[data-testid="save-post-confirm"]'
"$BROWSE" wait --networkidle
sleep 0.3

step "assert: kept in the vault"
assert_text "Kept in the vault"
assert_text "Kept"
snap "kept-in-vault"

echo "feed-e2e-01: PASS"
