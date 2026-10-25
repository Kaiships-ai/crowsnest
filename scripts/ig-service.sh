#!/usr/bin/env bash
#
# Starts the Instagram sidecar.
#
# .env.local is read by the sidecar itself (crowsnest_ig.config.load_env_file), NOT
# sourced by this script. That is deliberate: `. ./.env.local` executes the file, so a
# password containing a double quote aborts with "unexpected EOF while looking for
# matching quote", and one containing `$` or a backtick is silently mangled or executed.
# Real passwords contain exactly those characters — this bit us with a live account.
#
# Variables exported in your shell still win over the file, so one-off overrides work:
#   IG_PROXY='socks5://...' pnpm run ig:service
#   LOG_LEVEL=debug pnpm run ig:service
#
set -euo pipefail

cd "$(dirname "$0")/../services/ig"
exec uv run python -m crowsnest_ig
