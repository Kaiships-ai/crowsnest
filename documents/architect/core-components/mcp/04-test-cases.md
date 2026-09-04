# mcp: test cases

How to run these: the mcp component is covered by an offline vitest suite, `src/server/mcp/mcp-server.test.ts`. From the repo root, `npm run test` runs it, or `npx vitest run src/server/mcp/mcp-server.test.ts` for this file alone; all six cases pass. The cases that touch data migrate a temporary SQLite database in-process (`@/server/db/test-migrate`) and seed rows directly, so no network, no sidecar, and no LLM proxy are needed. The component has no screen of its own: it is called by an MCP client over `/api/mcp`, not driven through the crowsnest UI, so the behavior and browse-e2e lenses have nothing in the app to click and are noted N/A with their reason.

## 1. behavior

The mcp component has no interactive UI, so there is no in-app screen to exercise. Its user-observable behavior is what an MCP client sees when it calls the endpoint, which the route-and-action lens below covers at the handler level. The client-level behaviors worth a live check against a running crowsnest are listed here as not-run targets; each needs an MCP client connected to `/api/mcp`, not a browser.

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BEH-01 | P2 | mcp client | A client can list the tools and gets all 19 `crowsnest_*` tools with their input schemas ([read crowsnest data](03-feature-description.md#2-read-crowsnest-data)). | crowsnest running; an MCP client pointed at `/api/mcp`. | 1. Connect and call `tools/list`. | Nineteen tools are returned, seven read and twelve remix, each with its title, description, and input schema. | not run (needs an mcp client) |
| BEH-02 | P2 | mcp client | Calling `crowsnest_feed` returns the same outliers the dashboard feed shows, paged with a total ([read crowsnest data](03-feature-description.md#2-read-crowsnest-data)). | A database with synced videos. | 1. Call `crowsnest_feed` with a `limit`.<br>2. Compare against the dashboard feed. | `{ total, count, items }` comes back; the items match the dashboard for the same filters. | not run (needs an mcp client) |
| BEH-03 | P2 | mcp client | Driving the remix chain through the tools produces the same session and the same draft planned post the remix page produces ([drive a remix](03-feature-description.md#3-drive-a-remix)). | A source video; the LLM proxy up for the generate steps. | 1. Call session, set_prompt, research, hooks, choose_hook, outline, variants, save_script, finish in order. | `crowsnest_remix_finish` returns a `postId`; the same session and draft post are visible on the remix page. | not run (needs an mcp client and the proxy) |

Not checkable by hand: everything in this lens, because there is no crowsnest screen for the MCP; these are client-driven and belong to whatever MCP client integration exercises the endpoint.

## 2. route and action

These are the six cases in `src/server/mcp/mcp-server.test.ts`; all pass. They exercise the output contract, the media helper, and pagination at the handler level, reaching a tool handler through the server's internal `_registeredTools` registry rather than a live transport.

| ID | P | Layer | Claim | Setup | Call | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ACTION-01 | P1 | unit test (`mcp-server.test.ts`) | `result()` returns JSON text and `structuredContent` that agree, so a text-only client and a structured client see the same value. | none | `result({ ok: true, n: 2 })`. | `content[0]` is a text block whose parsed JSON equals the object, and `structuredContent` equals the same object. | pass |
| ACTION-02 | P1 | unit test (`mcp-server.test.ts`) | `errorResult()` sets `isError` and carries the payload, so a handled failure crosses the boundary as data, not a throw. | none | `errorResult({ error: "not found", id: "x" })`. | `isError` is true; `structuredContent` carries the payload. | pass |
| ACTION-03 | P1 | unit test (`mcp-server.test.ts`) | `mediaInfoFor` resolves `path`, `byteSize`, and `durationSec` from the stored asset row only, never touching the file. | Migrated DB; a recorded video asset, `byteSize` 555, `durationSec` 8.5. | `mediaInfoFor(asset.id)`. | Not null; `path` ends in the asset's extension and is absolute; `byteSize` is 555 and `durationSec` is 8.5, straight off the row. | pass |
| ACTION-04 | P1 | unit test (`mcp-server.test.ts`) | `mediaInfoFor` returns null for a null asset id rather than throwing. | Migrated DB. | `mediaInfoFor(null)`. | Returns null. | pass |
| ACTION-05 | P1 | unit test (`mcp-server.test.ts`) | `crowsnest_scripts` slices the full list by `limit`/`offset`; `total`/`count` reflect the slice. | Migrated DB seeded with two scripts. | Build the server, call `crowsnest_scripts` with `{ limit: 1, offset: 0 }`. | `total` at least 2; `count` equals `items.length`; the page holds at most one; `total` at least `count`. | pass |
| ACTION-06 | P1 | unit test (`mcp-server.test.ts`) | `crowsnest_ideas` slices within the requested tab by `limit`/`offset`. | Migrated DB seeded with a channel, two videos, two inbox ideas. | Build the server, call `crowsnest_ideas` with `{ tab: "inbox", limit: 1, offset: 0 }`. | `total` at least 2; `count` equals `items.length`; the page holds at most one; `total` at least `count`. | pass |

Not checkable by hand:

- The generate remix tools (`crowsnest_remix_hooks`, `crowsnest_remix_outline`, `crowsnest_remix_variants`, `crowsnest_remix_regenerate_variant`) call the model and are not exercised here; their backing service functions are covered under [remix](../remix/04-test-cases.md).
- The streamable HTTP transport and the `/api/mcp` route in `server.ts` are not exercised end to end; the suite calls handlers directly. Recorded in [architecture](02-architecture.md#8-open-not-verified).

## 3. browse-e2e

N/A. The mcp component has no browser UI, so there is no journey to script and no `data-testid` to add. A client that speaks MCP over `/api/mcp` is not a browser, and no crowsnest page invokes these tools. Any end-to-end verification lives in an MCP client integration (the behavior lens above), not in a `browse` journey.

## 4. security-lite

| ID | P | Threat | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-01 | P1 | Unauthenticated endpoint | `/api/mcp` requires no credential of its own. `handleMcpRequest` reads the body and dispatches to the tools with no token or auth check, so any caller that can reach the bound interface can call every tool. | crowsnest running. | 1. Read `src/server/mcp/http.ts` and `server.ts`.<br>2. POST a `tools/call` to `/api/mcp` with no auth header. | The call is served; there is no 401 path. The only gate is which interface the server binds. | not run (asserted from code; no live capture) |
| SEC-02 | P1 | Network exposure | The endpoint is reachable only on the interface `server.ts` binds. The packaged LaunchAgent sets `HOST=127.0.0.1`, so a buyer's endpoint is loopback-only; in dev `HOST` is unset and the server binds all interfaces, so `/api/mcp` is reachable from other hosts on the network. | Packaged run versus `npm run dev`. | 1. In a packaged run, attempt `/api/mcp` from another host.<br>2. In dev, attempt it from another host on the LAN. | Packaged: refused off-box (loopback only). Dev: reachable from the LAN, unauthenticated. | not run (asserted from code; no live capture) |
| SEC-03 | P2 | Second writer | The MCP is not a second database connection: it runs in the app's own process and calls the app's own query and service functions, so it shares the one SQLite connection and cannot race the app's writes. | Code review. | 1. Confirm `server.ts` routes `/api/mcp` in-process, not to a separate service. | No separate process or connection exists; every tool write goes through the app's connection. | pass (code review) |

Security-lite has no row for a license gate or cross-tenant leakage: the MCP has no license check of its own, and crowsnest is single-user with no tenants. SEC-01 and SEC-02 record the honest current posture, that the endpoint is unauthenticated and its reach is set only by the bound interface; this is stated, not yet verified with a live network capture, and is carried as an open item in [architecture](02-architecture.md#8-open-not-verified).
