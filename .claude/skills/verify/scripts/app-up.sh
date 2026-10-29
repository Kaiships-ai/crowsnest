#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
DIR=data/verify/app
mkdir -p "$DIR"

if [ -f "$DIR/host.pid" ] && kill -0 "$(cat "$DIR/host.pid")" 2>/dev/null; then
  echo "app: already running (host pid $(cat "$DIR/host.pid")). Run app-down.sh first." >&2
  exit 1
fi
# One lane app on the Mac at a time (four parallel lane apps pushed the load average to 70). The operator's
# own app from the main checkout does not count. APP_ALLOW_SECOND=1 is for a human who means it.
main_out="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/out/"
other=$(pgrep -fl "out/electron-dev/" | grep -v "$PWD/out/" | grep -v "$main_out" | head -1 || true)
if [ -n "$other" ] && [ "${APP_ALLOW_SECOND:-0}" != 1 ]; then
  echo "app: another lane app is running, one at a time on this Mac: $other. Wait for it, or stop it with that worktree's app-down.sh." >&2
  exit 1
fi
[ -d node_modules/electron ] || { echo "app: run 'pnpm install' first (node 24)" >&2; exit 1; }

# A lane never reaches the real Graph or the operator's sidecar: anything a lane script did not
# point at a fake goes to port 9 (discard), which refuses at once.
export IG_GRAPH_HOST="${IG_GRAPH_HOST:-http://127.0.0.1:9}"
export IG_SERVICE_URL="${IG_SERVICE_URL:-http://127.0.0.1:9}"

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
# the app refuses Cook in a lane that names none. One copy per worktree, so two lanes never write
# into each other's films/; the path outside any git checkout still ends in studio-reel, which keeps
# the shell prompt in the cook workspace shot the same. Render slots (studio-reel's RENDER_SLOTS lock
# dir) live beside it, so a lane's fixtures never see Kai's real renders, nor his them.
STUDIO="$HOME/Desktop/kaiships/studio-reel"
LANE_COOK="/tmp/lead-studio-cook/$(basename "$PWD")"
export RENDER_SLOT_DIR="$LANE_COOK/render-slots"
rm -rf "$RENDER_SLOT_DIR"
# APP_COOK_STUDIO=<dir> is a real cook run: a full studio-reel worktree the agent made (pixi installed),
# used as it is and never wiped. It must not be Kai's checkout.
if [ -n "${APP_COOK_STUDIO:-}" ]; then
  [ "$(cd "$APP_COOK_STUDIO" && pwd -P)" != "$(cd "$STUDIO" 2>/dev/null && pwd -P)" ] \
    || { echo "app: APP_COOK_STUDIO is Kai's studio-reel checkout; make a worktree" >&2; exit 1; }
  export LEAD_STUDIO_COOK_ROOT="$APP_COOK_STUDIO"
else
  export LEAD_STUDIO_COOK_ROOT="$LANE_COOK/studio-reel"
  rm -rf "$LEAD_STUDIO_COOK_ROOT" && mkdir -p "$LEAD_STUDIO_COOK_ROOT"
  for f in CLAUDE.md AGENTS.md workspace/README.md .claude/settings.json .claude/skills/make-reel/SKILL.md core/job.mjs; do
    if [ -f "$STUDIO/$f" ]; then
      mkdir -p "$LEAD_STUDIO_COOK_ROOT/$(dirname "$f")" && cp "$STUDIO/$f" "$LEAD_STUDIO_COOK_ROOT/$f"
    fi
  done
fi

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
