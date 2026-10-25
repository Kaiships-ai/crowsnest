#!/usr/bin/env bash
# mcp.sh [--app] <tool | tools/list> [json-args] -- one JSON-RPC call against the verify
# instance's MCP at /api/mcp (local-host requests only, no token). --app targets the Lead
# Studio app that app-up.sh launched. Prints the server's SSE reply.
set -uo pipefail
cd "$(dirname "$0")/../../../.."
if [ "${1:-}" = --app ]; then
  shift
  PORT="$(cat data/verify/app/mcp.port 2>/dev/null)" || { echo "mcp: no app running (data/verify/app/mcp.port)" >&2; exit 1; }
else
  PORT="$(cat data/verify/server.port 2>/dev/null || echo 3001)"
fi
T="${1:?usage: mcp.sh [--app] <tool, e.g. crowsnest_plans | tools/list> [json-args]}"
if [ "$T" = tools/list ]; then
  BODY='{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
else
  ARGS="${2:-}"
  [ -n "$ARGS" ] || ARGS="{}"
  BODY="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$T\",\"arguments\":$ARGS}}"
fi
curl -s -X POST "http://localhost:$PORT/api/mcp" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' -d "$BODY"
echo
