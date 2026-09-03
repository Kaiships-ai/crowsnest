# mcp: test cases

How to run these: the MCP component is covered by an offline vitest suite, `src/server/mcp/mcp-server.test.ts`. From the repo root, `npm run test` runs it (or `vitest run src/server/mcp/mcp-server.test.ts` for this file alone). The tests that touch data migrate a temporary SQLite database in-process (`@/server/db/test-migrate`) and seed rows directly; no network, no sidecar, and no LLM proxy are needed, because these cases exercise the output contract, pagination, and the media helper, not the generate tools. The remix generate tools (hooks, outline, variants), which call the model, are not exercised here.

The MCP has no UI: there are no `data-testid` values, no browse-e2e cases, and no in-page surface to drive. The cases below are the vitest cases that exist.

## 1. Output contract

| ID | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- |
| MCP-01 | `result()` returns JSON text and `structuredContent` that agree, so a text-only client and a structured client see the same value. | none | Call `result({ ok: true, n: 2 })`. | `content[0]` is a text block whose parsed JSON equals `{ ok: true, n: 2 }`, and `structuredContent` equals the same object. | pass |
| MCP-02 | `errorResult()` sets `isError` and carries the payload, so a handled failure crosses the boundary as data, not a throw. | none | Call `errorResult({ error: "not found", id: "x" })`. | `isError` is true, and `structuredContent` carries `{ error: "not found", id: "x" }`. | pass |

## 2. Media handoff

| ID | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- |
| MCP-03 | `mediaInfoFor` resolves `path`, `byteSize`, and `durationSec` from the stored asset row only, never touching the file. | Migrated DB; a recorded video asset with `byteSize` 555 and `durationSec` 8.5. | Call `mediaInfoFor(asset.id)`. | Not null; `path` ends in the asset's extension and is absolute; `byteSize` is 555 and `durationSec` is 8.5, straight off the row. | pass |
| MCP-04 | `mediaInfoFor` returns null for a null asset id rather than throwing. | Migrated DB. | Call `mediaInfoFor(null)`. | Returns null. | pass |

## 3. Pagination

| ID | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- |
| MCP-05 | `crowsnest_scripts` slices the full list by `limit`/`offset`, and `total`/`count` reflect the slice. | Migrated DB seeded with two scripts. | Build the server, call `crowsnest_scripts` with `{ limit: 1, offset: 0 }`. | `total` is at least 2; `count` equals `items.length`; the page holds at most one item; `total` is at least `count`. | pass |
| MCP-06 | `crowsnest_ideas` slices within the requested tab by `limit`/`offset`. | Migrated DB seeded with a channel, two videos, and two inbox ideas. | Build the server, call `crowsnest_ideas` with `{ tab: "inbox", limit: 1, offset: 0 }`. | `total` is at least 2; `count` equals `items.length`; the page holds at most one item; `total` is at least `count`. | pass |

The pagination cases reach a tool handler directly through the server's internal tool registry (`_registeredTools`), which is the lightest way to call a tool in a test without standing up a client and transport pair. That test hook is a known simplification, recorded in [backlog to enhance](05-backlog-to-enhance.md).

## 4. Not covered here

- The generate remix tools (`crowsnest_remix_hooks`, `crowsnest_remix_outline`, `crowsnest_remix_variants`, `crowsnest_remix_regenerate_variant`) call the model and are not exercised by this suite; their backing service functions are covered under [remix](../remix/04-test-cases.md).
- The streamable HTTP transport and the `/api/mcp` route in `server.ts` are not exercised end to end here; the suite tests the tool handlers and the contract helpers directly.
- The read tools other than the two paginated ones (`crowsnest_feed`, `crowsnest_video`, `crowsnest_brief`, `crowsnest_metrics`, `crowsnest_plans`) are thin wrappers whose data logic is covered by their backing queries' own tests; only the media enrichment on `crowsnest_video`/`crowsnest_brief`, through `mediaInfoFor`, is tested here.
