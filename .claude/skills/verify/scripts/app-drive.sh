#!/usr/bin/env bash
# Drives the app app-up.sh started. See app-drive.mjs for the modes.
#   app-drive.sh <journey> [run-id]   app-journeys/<journey>.mjs; transcript + screenshots in data/verify/evidence/<run-id>/
#   app-drive.sh --console            host log: main process output and renderer console
#   app-drive.sh --timing [rounds]    cold start of Orca.app vs Lead Studio, needs no running app
set -euo pipefail
cd "$(dirname "$0")/../../../.."
exec node_modules/.bin/tsx .claude/skills/verify/scripts/app-drive.mjs "$@"
