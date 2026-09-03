# mcp: backlog to enhance

Bugs and enhancements for the mcp component. One row per item.

| ID | Title | Severity | Type | Source | Status |
| --- | --- | --- | --- | --- | --- |
| ENH-1 | `crowsnest_scripts` and `crowsnest_ideas` slice in memory over the full list; push `limit`/`offset` into SQL (`LIMIT`/`OFFSET` in `getScripts`/`listIdeas`) if either list ever holds thousands of rows | low | enhancement | code comment | open |
| ENH-2 | The mcp-server test drives tool handlers through the server's private `_registeredTools` registry with a cast; move to a shared `InMemoryTransport` plus `Client` harness if more MCP tests are added | low | enhancement | test comment | open |
