# MCP agent tokens

Every `/api/mcp` request needs `Authorization: Bearer <token>`. Each agent has its own revocable token; only its SHA-256 hash is stored in `mcp_tokens`. On start the app mints a fresh `local` token into `<userData>/mcp.token` (mode 0600), which `scripts/lead-studio-mcp.mjs` and `mcp.sh` send. The journal `caller` is the token's name. Architecture: `documents/architecture/mcp.md` (Agent tokens).

## Sub-features

- No token, a wrong token, or a revoked token: 401 with a JSON-RPC error, and no tool runs.
- Bridge `createMcpToken(name)` returns the raw token once; `listMcpTokens` returns id, name, created, last used, revoked (no hash); `revokeMcpToken(id)` refuses the token on the next request.
- `local` is rotated on each start and its file removed on quit.

## How to get to it (user POV)

No board shows tokens yet; the Agents board will. Kai's Claude sessions use `local` through `.mcp.json` with no setup.

## Driving it

```bash
.claude/skills/verify/scripts/app-up.sh --seed
.claude/skills/verify/scripts/mcp.sh --app tools/list
curl -s -o /dev/null -w '%{http_code}\n' -X POST "http://localhost:$(cat data/verify/app/mcp.port)/api/mcp" -H 'content-type: application/json' -d '{}'
stat -f %Lp data/verify/app/mcp.token
.claude/skills/verify/scripts/app-drive.sh tokens-01 [run-id]
.claude/skills/verify/scripts/app-down.sh
```

`curl` with no header prints `401`; `stat` prints `600`. `tokens-01` prints `ok: a call with no token is refused with 401`, `ok: a token made through the bridge calls the MCP and names the journal row`, `ok: a revoked token is refused with 401 right after revoke`, and saves `tokens-01.png`.

## Gotchas

- `data/verify/app/mcp.token` is a copy `app-host.mjs` makes from the lane's user data; both are gone after `app-down.sh`.
- A lane DB keeps revoked rows, so `tokens-01` names each token with a timestamp to stay rerunnable.
