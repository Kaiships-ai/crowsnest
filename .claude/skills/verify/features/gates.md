# Gate levels and the agent journal

Every MCP tool has a level in `TOOL_LEVELS` (`src/server/mcp/gates.ts`): read, free, gate 1, or gate 2. Every non-read call appends a row to the append-only `agent_actions` journal, and a gate 2 call is stored in `gate_drafts` and never runs. The bridge call `listAgentActions` reads the journal. Architecture: `documents/architecture/mcp.md`.

## Sub-features

- Level per tool, checked at registration: a tool with no level does not compile and throws at startup.
- Journal row per free, gate 1 and gate 2 call: time, caller (the token name over HTTP, see [tokens.md](tokens.md)), tool, scrubbed input, result, gate, draft id.
- Gate 2 draft: `{ status: "pending_approval", draftId }`, nothing sent. No tool is gate 2 yet, so the app lane proves read, free and gate 1; `src/server/mcp/gates.test.ts` proves gate 2 with a fixture tool.
- `crowsnest_attach_video` takes only a draft; a scheduled or failed plan returns `PLAN_NOT_DRAFT`.
- A free or gate 1 call writes a `pending` row before it runs and an outcome row after, with one `call_id`. No `pending` row, no run (`JOURNAL_UNAVAILABLE`).

## How to get to it (user POV)

The Agents board shows the journal (see [boards.md](boards.md), journey `agents-01`); the Cổng 2 board will also read `listAgentActions`. Today an agent calls the app's MCP and the journal is read through the bridge.

## Driving it

```bash
.claude/skills/verify/scripts/app-up.sh --seed
.claude/skills/verify/scripts/mcp.sh --app tools/list
.claude/skills/verify/scripts/app-drive.sh gates-01 [run-id]
.claude/skills/verify/scripts/app-down.sh
```

`gates-01` prints `ok: a read over MCP leaves no journal row`, `ok: a gate 1 call is journaled with caller, scrubbed input, result, and gate`, `ok: a free call is journaled as free`, and saves `gates-01.png`. Read the rows back with `sqlite3 <userData>/crowsnest.db "select * from agent_actions"`.

## Gotchas

- The journey proposes a `2026-W53` plan; 2026 has 53 ISO weeks. A rerun on the same lane DB proposes the next version, which still journals `ok`.
- The journal is append-only by trigger, so a lane DB keeps every row until a fresh `app-up.sh --seed`.
