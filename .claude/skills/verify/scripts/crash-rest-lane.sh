#!/usr/bin/env bash
# crash-rest-lane.sh [run-id] -- crash-rest-01 on a seeded app with the fake Graph and the fake
# sidecar leaves pull B running on both cards; the lane copies the DB mid pull (the state a quit
# or crash leaves), quits the app, reopens a new app on that copy, and crash-rest-02 runs Pull the rest.
set -euo pipefail
cd "$(dirname "$0")/../../../.."
S=.claude/skills/verify/scripts
DIR=data/verify/app
RUN="${1:-crash-rest}"
mkdir -p "$DIR"
start_fake() { # start_fake <name> <env var> -- starts fake-<name>.mjs and points the app at it
  rm -f "$DIR/fake-$1.port"
  node "$S/fake-$1.mjs" >>"$DIR/fake-$1.log" 2>&1 &
  echo $! >"$DIR/fake-$1.pid"
  for _ in $(seq 1 50); do [ -s "$DIR/fake-$1.port" ] && break; sleep 0.1; done
  [ -s "$DIR/fake-$1.port" ] || { echo "crash-rest: fake $1 did not start, see $DIR/fake-$1.log" >&2; exit 1; }
  export "$2=http://127.0.0.1:$(cat "$DIR/fake-$1.port")"
}
: >"$DIR/fake-graph.log"; : >"$DIR/fake-sidecar.log"
export APP_DEV="${APP_DEV:-1}"
start_fake graph IG_GRAPH_HOST
start_fake sidecar IG_SERVICE_URL
"$S/app-up.sh" --seed
"$S/app-drive.sh" crash-rest-01 "$RUN"
USER_DATA="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).userDataDir)' "$DIR/state.json")"
rm -f "$DIR/restart.db"
sqlite3 "$USER_DATA/crowsnest.db" ".backup '$DIR/restart.db'"
"$S/app-down.sh" >/dev/null
echo "crash-rest: app quit mid pull; reopening on the DB copied mid pull ($DIR/restart.db)"
start_fake graph IG_GRAPH_HOST
start_fake sidecar IG_SERVICE_URL
APP_REAL_DB="$DIR/restart.db" "$S/app-up.sh" --real
"$S/app-drive.sh" crash-rest-02 "$RUN"
