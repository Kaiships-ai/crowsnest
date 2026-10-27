#!/usr/bin/env bash
# card-state-lane.sh [run-id] -- card-state-01 on a seeded app with the fake sidecar, then a real
# restart: the app quits, a new app opens a copy of the same DB, and card-state-02 reads the cards.
set -euo pipefail
cd "$(dirname "$0")/../../../.."
S=.claude/skills/verify/scripts
DIR=data/verify/app
RUN="${1:-card-state}"
mkdir -p "$DIR"
start_sidecar() {
  rm -f "$DIR/fake-sidecar.port"
  node "$S/fake-sidecar.mjs" >>"$DIR/fake-sidecar.log" 2>&1 &
  echo $! >"$DIR/fake-sidecar.pid"
  for _ in $(seq 1 50); do [ -s "$DIR/fake-sidecar.port" ] && break; sleep 0.1; done
  [ -s "$DIR/fake-sidecar.port" ] || { echo "card-state: fake sidecar did not start, see $DIR/fake-sidecar.log" >&2; exit 1; }
  export IG_SERVICE_URL="http://127.0.0.1:$(cat "$DIR/fake-sidecar.port")"
}
: >"$DIR/fake-sidecar.log"
start_sidecar
"$S/app-up.sh" --seed
"$S/app-drive.sh" card-state-01 "$RUN"
USER_DATA="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).userDataDir)' "$DIR/state.json")"
rm -f "$DIR/restart.db"
sqlite3 "$USER_DATA/crowsnest.db" ".backup '$DIR/restart.db'"
"$S/app-down.sh" >/dev/null
echo "card-state: app quit; reopening on the same DB ($DIR/restart.db)"
start_sidecar
APP_REAL_DB="$DIR/restart.db" "$S/app-up.sh" --real
"$S/app-drive.sh" card-state-02 "$RUN"
