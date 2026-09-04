# mcp: backlog to enhance

Bugs and enhancements for the mcp component. One row per item.

| ID | Title | Severity | Type | Source | Status |
| --- | --- | --- | --- | --- | --- |
| ENH-1 | `crowsnest_scripts` and `crowsnest_ideas` slice in memory over the full list; push `limit`/`offset` into SQL (`LIMIT`/`OFFSET` in `getScripts`/`listIdeas`) if either list ever holds thousands of rows | low | enhancement | code comment | open |
| ENH-2 | The mcp-server test drives tool handlers through the server's private `_registeredTools` registry with a cast; move to a shared `InMemoryTransport` plus `Client` harness if more MCP tests are added. A client round-trip harness would have caught the structuredContent-must-be-a-record defect that only a live client surfaced | medium | enhancement | test comment, Round 1 | open |
| ENH-3 | `post-brief.test.ts` fixtures still use `Studio subject` and `@studio-test-` strings; rename to neutral fixture values so the doc-and-code vocabulary reads clean (harmless, cosmetic) | low | cleanup | Round 1 review | open |
