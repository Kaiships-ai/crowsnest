#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
DIR=data/verify/app
mkdir -p "$DIR"

if [ -f "$DIR/host.pid" ] && kill -0 "$(cat "$DIR/host.pid")" 2>/dev/null; then
  echo "app: already running (host pid $(cat "$DIR/host.pid")). Run app-down.sh first." >&2
  exit 1
fi
[ -d node_modules/electron ] || { echo "app: run 'pnpm install' first (node 24)" >&2; exit 1; }

unset APP_DB
case "${1:-}" in
  --seed)
    CROWSNEST_DB_PATH="$DIR/seed.db" node_modules/.bin/tsx scripts/seed-e2e.ts >"$DIR/seed.log" 2>&1 \
      || { echo "app: seed failed, see $DIR/seed.log" >&2; tail -20 "$DIR/seed.log" >&2; exit 1; }
    export APP_DB="$DIR/seed.db" ;;
  --real) export APP_DB="${APP_REAL_DB:-data/crowsnest.db}" ;;
esac

# APP_DEV=1 skips the full build: app-host.mjs runs electron-vite dev (renderer HMR, main rebuilt on change).
if [ "${APP_DEV:-0}" = 1 ]; then
  pnpm run build:packages >"$DIR/build.log" 2>&1 || { echo "app: build:packages failed, see $DIR/build.log" >&2; exit 1; }
elif [ "${APP_SKIP_BUILD:-0}" != 1 ]; then
  { pnpm run build:packages && VITE_EXPOSE_STORE=true scripts/heavy.sh pnpm exec electron-vite build --mode e2e; } >"$DIR/build.log" 2>&1 \
    || { echo "app: build failed, see $DIR/build.log" >&2; tail -30 "$DIR/build.log" >&2; exit 1; }
fi

# Lead Studio must never touch the installed Orca.app's hooks: app-down.sh compares these after the run.
host_fingerprint() {
  { jq -S '.hooks // {}' "$HOME/.claude/settings.json" 2>/dev/null; cat "$HOME"/.orca/agent-hooks/* 2>/dev/null; } | shasum | cut -d' ' -f1
}
host_fingerprint >"$DIR/host.fingerprint"

# Cook writes into a temp studio-reel copy (its docs and make-reel skill only), never Kai's checkout;
# the app refuses Cook in a lane that names none. A fixed path outside any git checkout keeps the
# shell prompt in the cook workspace shot the same.
STUDIO="$HOME/Desktop/kaiships/studio-reel"
export LEAD_STUDIO_COOK_ROOT="/tmp/lead-studio-cook/studio-reel"
rm -rf "$LEAD_STUDIO_COOK_ROOT" && mkdir -p "$LEAD_STUDIO_COOK_ROOT"
for f in CLAUDE.md AGENTS.md workspace/README.md .claude/skills/make-reel/SKILL.md; do
  if [ -f "$STUDIO/$f" ]; then
    mkdir -p "$LEAD_STUDIO_COOK_ROOT/$(dirname "$f")" && cp "$STUDIO/$f" "$LEAD_STUDIO_COOK_ROOT/$f"
  fi
done

rm -f "$DIR/state.json"
set -m
node_modules/.bin/tsx .claude/skills/verify/scripts/app-host.mjs >"$DIR/host.log" 2>&1 &
echo $! >"$DIR/host.pid"
set +m

for _ in $(seq 1 300); do
  if grep -q "^app: ready" "$DIR/host.log"; then
    grep "^app: ready" "$DIR/host.log"
    exit 0
  fi
  kill -0 "$(cat "$DIR/host.pid")" 2>/dev/null || { echo "app: host exited, see $DIR/host.log" >&2; tail -30 "$DIR/host.log" >&2; exit 1; }
  sleep 1
done
echo "app: not ready after 300s, see $DIR/host.log" >&2
exit 1
