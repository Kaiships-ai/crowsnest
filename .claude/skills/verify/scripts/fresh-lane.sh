#!/usr/bin/env bash
# Fresh-profile lane: the seed DB but no project open, the state a first launch is in, then
# fresh-01. Every other lane seeds a repo, so this is the only one that drives a profile with no
# workspace.
set -euo pipefail
cd "$(dirname "$0")/../../../.."
S=.claude/skills/verify/scripts
export APP_NO_REPO=1
export APP_HEADLESS="${APP_HEADLESS:-1}"
export APP_DEV="${APP_DEV:-1}"
"$S/app-up.sh" --seed
"$S/app-drive.sh" fresh-01 "${1:-fresh}"
