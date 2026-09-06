# mcp: backlog to enhance

Bugs and enhancements for the mcp component. One row per item.

| ID | Title | Severity | Type | Source | Status |
| --- | --- | --- | --- | --- | --- |
| ENH-1 | `crowsnest_scripts` and `crowsnest_ideas` slice in memory over the full list; push `limit`/`offset` into SQL (`LIMIT`/`OFFSET` in `getScripts`/`listIdeas`) if either list ever holds thousands of rows | low | enhancement | code comment | open |
| ENH-2 | The mcp-server test drives tool handlers through the server's private `_registeredTools` registry with a cast; move to a shared `InMemoryTransport` plus `Client` harness if more MCP tests are added. A client round-trip harness would have caught the structuredContent-must-be-a-record defect that only a live client surfaced | medium | enhancement | test comment, Round 1 | closed (mcp-roundtrip.test.ts adds a live `InMemoryTransport` + `Client` round trip alongside the registry tests; monthly-planning-tools plan) |
| ENH-3 | `post-brief.test.ts` fixtures still use `Studio subject` and `@studio-test-` strings; rename to neutral fixture values so the doc-and-code vocabulary reads clean (harmless, cosmetic) | low | cleanup | Round 1 review | open |
| ENH-4 | `crowsnest_outlier_pack` rising mode ranks by recency only (the feed's `recent` sort); there is no velocity signal (views per day since posting), so a fresh video with few views can outrank a genuine surge. Add a velocity ranking to `getOutlierPack` if the weekly refresh needs true momentum, not just recency | low | enhancement | shipped code (`queries/research.ts`) | open |
| ENH-5 | `crowsnest_channel_stats.lastRun` uses `getLastRunHealth`, which returns the last sync run overall, not one scoped to the requested channel; the reported health can be from a different channel's sync. Scope run health to the channel if per-channel sync health matters | low | enhancement | shipped code (`mcp-server.ts`, `queries/runs.ts`) | open |
