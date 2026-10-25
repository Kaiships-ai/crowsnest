#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
exec node_modules/.bin/tsx .claude/skills/verify/scripts/app-drive.mjs "$@"
