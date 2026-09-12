#!/usr/bin/env bash
# mine-e2e-02 -- documents/architect/core-components/mine/04-test-cases.md, E2E-02.
#
# Plan a post from an empty calendar day, then find it on the grid, through the real UI.
#
# Arrive: /mine, seeded channel already marked own (scripts/seed-e2e.ts), Month tab is
# the default tab so no extra click is needed to reach it. No planned_posts or own_posts
# rows are seeded, so every day in the current month renders "open" -- any day works.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/e2e/lib.sh

TARGET_DATE="$(date +%Y-%m)-15"
PLAN_TITLE="E2E fixture plan $$"

step "arrive: open /mine (Month tab is the default)"
goto_and_settle "$BASE_URL/mine"
"$BROWSE" wait "[data-testid=\"mine-calendar-day\"][data-id=\"$TARGET_DATE\"]"

step "act: click the empty day cell ($TARGET_DATE)"
"$BROWSE" click "[data-testid=\"mine-calendar-day\"][data-id=\"$TARGET_DATE\"]"
"$BROWSE" wait '[data-testid="mine-calendar-plan-day"]'

step "act: plan something for this day"
"$BROWSE" click '[data-testid="mine-calendar-plan-day"]'
"$BROWSE" wait '[data-testid="plan-dialog-title"]'
"$BROWSE" fill '[data-testid="plan-dialog-title"]' "$PLAN_TITLE"

# No script is picked, so the dialog's "I don't have a script yet" checkbox must be
# ticked before Save enables (plan-dialog.tsx's canSave). That checkbox carries no
# data-testid and this task's write list does not include plan-dialog.tsx to add one --
# `[data-slot="checkbox"]` is the base-ui Checkbox's own stable slot attribute, unique
# within the open dialog, so it stands in for a testid here.
"$BROWSE" click '[data-slot="checkbox"]'

step "act: create plan"
"$BROWSE" click '[data-testid="plan-dialog-save"]'
"$BROWSE" wait --networkidle
sleep 0.3

step "assert: toast and dialog close"
assert_text "Planned"

step "assert: the day cell shows the plan's title"
assert_text "$PLAN_TITLE"
snap "planned-on-grid"

echo "mine-e2e-02: PASS"
