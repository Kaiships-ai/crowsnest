#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
DIR=data/verify/app
mkdir -p "$DIR"

if [ -f "$DIR/host.pid" ] && kill -0 "$(cat "$DIR/host.pid")" 2>/dev/null; then
  echo "app: already running (host pid $(cat "$DIR/host.pid")). Run app-down.sh first." >&2
  exit 1
fi
[ -d studio/node_modules ] || { echo "app: run 'pnpm install' in studio/ first" >&2; exit 1; }

if [ "${APP_SKIP_BUILD:-0}" != 1 ]; then
  (cd studio && pnpm run build:packages && VITE_EXPOSE_STORE=true npx electron-vite build --mode e2e) >"$DIR/build.log" 2>&1 \
    || { echo "app: build failed, see $DIR/build.log" >&2; tail -30 "$DIR/build.log" >&2; exit 1; }
fi

rm -f "$DIR/state.json"
set -m
node_modules/.bin/tsx .claude/skills/verify/scripts/app-host.mjs >"$DIR/host.log" 2>&1 &
echo $! >"$DIR/host.pid"
set +m

for _ in $(seq 1 180); do
  if grep -q "^app: ready" "$DIR/host.log"; then
    grep "^app: ready" "$DIR/host.log"
    exit 0
  fi
  kill -0 "$(cat "$DIR/host.pid")" 2>/dev/null || { echo "app: host exited, see $DIR/host.log" >&2; tail -30 "$DIR/host.log" >&2; exit 1; }
  sleep 1
done
echo "app: not ready after 180s, see $DIR/host.log" >&2
exit 1
