#!/usr/bin/env bash
# real-check.sh umami|graph --db <lane crowsnest.db> [--proof <proof.json>] -- app value vs real value, read-only GETs.
exec node "$(dirname "$0")/real-check.mjs" "$@"
