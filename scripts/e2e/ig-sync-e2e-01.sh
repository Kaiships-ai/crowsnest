#!/usr/bin/env bash
# ig-sync-e2e-01 -- adapted from documents/architect/core-components/ig-sync/
# 04-test-cases.md, browse-e2e E2E-01 ("track a new channel by handle").
#
# That case's own setup calls for the sidecar up and logged in, which needs a live
# burner Instagram account (services/ig/README.md) -- not something this harness can
# assume on every machine it runs on. This journey deliberately runs the SAME add-
# channel flow with the sidecar down instead, and asserts the inline error path
# (add-channel-dialog.tsx's `error` Alert) rather than the tracked-success path:
# `startSyncAction`/`addChannelAction`'s ACTION-01 in the route-and-action lens already
# covers "IG_SERVICE_DOWN, never an empty result" at the action layer, so this journey
# is checking that the SAME fact renders correctly through the real UI, end to end.
#
# Arrive: /channels, sidecar NOT running.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/e2e/lib.sh

HANDLE="e2e_ig_sync_probe_$$"

if curl -fs -o /dev/null --max-time 1 "http://127.0.0.1:8765/health" 2>/dev/null; then
  echo "ig-sync-e2e-01: the sidecar answered on :8765 -- this journey needs it stopped" >&2
  echo "  (stop it, then re-run: this is the 'sidecar down' inline-error journey, not the live add-channel one)" >&2
fi

step "arrive: open /channels"
goto_and_settle "$BASE_URL/channels"
"$BROWSE" wait '[data-testid="channels-add-channel-trigger"]'

step "act: open the add channel dialog on the By handle tab"
"$BROWSE" click '[data-testid="channels-add-channel-trigger"]'
"$BROWSE" wait '[data-testid="add-channel-handle-input"]'
assert_text "By handle"

step "act: type a handle and submit"
"$BROWSE" fill '[data-testid="add-channel-handle-input"]' "$HANDLE"
"$BROWSE" click '[data-testid="add-channel-submit-handle"]'
"$BROWSE" wait --networkidle
sleep 0.5

step "assert: the inline error names the sidecar being down, not a toast"
assert_text "The Instagram service isn't running."

echo "ig-sync-e2e-01: PASS"
