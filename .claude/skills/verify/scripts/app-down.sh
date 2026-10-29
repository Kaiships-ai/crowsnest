#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../../../.."
DIR=data/verify/app
PID="$(cat "$DIR/host.pid" 2>/dev/null || true)"
if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
  kill -TERM "$PID"
  for _ in $(seq 1 30); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
  kill -0 "$PID" 2>/dev/null && kill -KILL -- "-$PID" 2>/dev/null
  echo "app: stopped host $PID"
else
  echo "app: no app of ours running"
fi
rm -f "$DIR/host.pid" "$DIR/state.json"
FAKE="$(cat "$DIR/fake-graph.pid" 2>/dev/null || true)"
[ -n "$FAKE" ] && kill "$FAKE" 2>/dev/null && echo "app: stopped fake Graph $FAKE"
rm -f "$DIR/fake-graph.pid" "$DIR/fake-graph.port"
SIDECAR="$(cat "$DIR/fake-sidecar.pid" 2>/dev/null || true)"
[ -n "$SIDECAR" ] && kill "$SIDECAR" 2>/dev/null && echo "app: stopped fake sidecar $SIDECAR"
rm -f "$DIR/fake-sidecar.pid" "$DIR/fake-sidecar.port"
UMAMI="$(cat "$DIR/fake-umami.pid" 2>/dev/null || true)"
[ -n "$UMAMI" ] && kill "$UMAMI" 2>/dev/null && echo "app: stopped fake Umami $UMAMI"
rm -f "$DIR/fake-umami.pid" "$DIR/fake-umami.port"
POLAR="$(cat "$DIR/fake-polar.pid" 2>/dev/null || true)"
[ -n "$POLAR" ] && kill "$POLAR" 2>/dev/null && echo "app: stopped fake Polar $POLAR"
rm -f "$DIR/fake-polar.pid" "$DIR/fake-polar.port"
rc=0
if [ -f "$DIR/host.fingerprint" ]; then
  now="$({ jq -S '.hooks // {}' "$HOME/.claude/settings.json" 2>/dev/null; cat "$HOME"/.orca/agent-hooks/* 2>/dev/null || true; } | shasum | cut -d' ' -f1)"
  if [ "$now" != "$(cat "$DIR/host.fingerprint")" ]; then
    echo "app: HOST CHANGED: ~/.claude/settings.json hooks or ~/.orca/agent-hooks differ from before app-up. Report it with a revert path; a plugin install or Orca.app restart during the run also trips it." >&2
    rc=1
  fi
  rm -f "$DIR/host.fingerprint"
fi
"$(dirname "$0")/keep-evidence.sh"
exit $rc
