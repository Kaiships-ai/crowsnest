#!/usr/bin/env bash
# mcp.sh <tool> [json-args] -- one JSON-RPC tools/call against the verify instance's MCP
# at /api/mcp (local-host requests only, no token). Prints the server's SSE reply.
set -uo pipefail
cd "$(dirname "$0")/../../../.."
PORT="$(cat data/verify/server.port 2>/dev/null || echo 3001)"
T="${1:?usage: mcp.sh <tool, e.g. crowsnest_plans> [json-args]}"
curl -s -X POST "http://localhost:$PORT/api/mcp" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$T\",\"arguments\":${2:-{\}}}}"
echo
