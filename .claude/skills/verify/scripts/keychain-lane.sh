#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
NAME="lead-studio-lane-$$"
SERVICE="$NAME Safe Storage"
TMP="$ROOT/data/verify/keychain-lane"
rm -rf "$TMP" && mkdir -p "$TMP"
trap 'security delete-generic-password -s "$SERVICE" >/dev/null 2>&1 && echo "keychain: deleted \"$SERVICE\""; security find-generic-password -s "$SERVICE" >/dev/null 2>&1 && echo "keychain: STILL PRESENT \"$SERVICE\"" && exit 1; rm -rf "$TMP"' EXIT
if security find-generic-password -s "$SERVICE" >/dev/null 2>&1; then echo "keychain: $SERVICE already exists, refusing"; exit 1; fi
cd "$ROOT"
node_modules/.bin/esbuild .claude/skills/verify/scripts/keychain-lane/entry.ts --bundle --platform=node --format=cjs \
  --alias:@=./src --external:electron --external:better-sqlite3 --outfile="$TMP/main.js" --log-level=warning
CROWSNEST_DB_PATH="$TMP/lane.db" LANE_APP_NAME="$NAME" ELECTRON_RUN_AS_NODE= node_modules/.bin/electron "$TMP/main.js"
echo "keychain-lane: pass ($SERVICE)"
