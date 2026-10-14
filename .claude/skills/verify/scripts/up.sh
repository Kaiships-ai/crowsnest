#!/usr/bin/env bash
# Builds, seeds data/e2e.db, and starts an isolated production server on :3001.
# Production mode because Next 16 refuses a second `next dev` in the same checkout,
# and the operator's own dev server on :3000 usually holds that lock.
set -euo pipefail
cd "$(dirname "$0")/../../../.."
PORT="${VERIFY_PORT:-3001}"
DIR=data/verify
mkdir -p "$DIR"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "verify: :$PORT is already in use. Run doctor.sh; if it is not ours, pick VERIFY_PORT." >&2
  exit 1
fi

if [ "${VERIFY_SKIP_BUILD:-0}" != 1 ]; then
  npm run build >"$DIR/build.log" 2>&1 \
    || { echo "verify: build failed, see $DIR/build.log" >&2; tail -30 "$DIR/build.log" >&2; exit 1; }
fi

CROWSNEST_DB_PATH=data/e2e.db npx tsx scripts/seed-e2e.ts >"$DIR/seed.log" 2>&1 \
  || { echo "verify: seed failed, see $DIR/seed.log" >&2; tail -20 "$DIR/seed.log" >&2; exit 1; }

set -m
PORT="$PORT" CROWSNEST_DB_PATH=data/e2e.db npm run start >"$DIR/server.log" 2>&1 &
echo $! >"$DIR/server.pid"
echo "$PORT" >"$DIR/server.port"
set +m

for _ in $(seq 1 90); do
  if curl -fs -o /dev/null --max-time 2 "http://localhost:$PORT/feed"; then
    echo "verify: ready on http://localhost:$PORT (pid $(cat "$DIR/server.pid"), db data/e2e.db)"
    exit 0
  fi
  kill -0 "$(cat "$DIR/server.pid")" 2>/dev/null || { echo "verify: server exited, see $DIR/server.log" >&2; tail -30 "$DIR/server.log" >&2; exit 1; }
  sleep 1
done
echo "verify: :$PORT never served /feed in 90s, see $DIR/server.log" >&2
exit 1
