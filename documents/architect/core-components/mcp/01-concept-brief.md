# mcp: concept brief

`documents/architect/core-components/mcp/`

Status: shipped, mounted in-process at `/api/mcp` over the app's one SQLite connection, exposing 19 `crowsnest_*` tools (seven read, twelve remix).

## 1. What it is

The mcp component is the Model Context Protocol server crowsnest runs inside its own process, at `/api/mcp`. It exposes the app's own data and its remix pipeline as a set of tools an MCP client can call: browse the outlier feed, read one video with its analysis, read a post brief, list saved scripts, ideas, own channel metrics, and planned posts, and drive a remix from research through hooks, outline, variants, and a saved script. Every tool is a thin wrapper over a query or service function the dashboard already uses, so the tool surface and the UI read and write the same data through the same code (`src/server/mcp/mcp-server.ts`).

The point of the component is handoff. crowsnest finds outliers, analyzes them, and remixes them into a script and a planned post; the MCP is the surface where that work leaves crowsnest and reaches the tool that produces the finished reel, the Reel Factory. For a video or a post brief the server returns not just the row but its media: the on-disk path, byte size, and duration of the stored video and thumbnail assets, read straight off the stored `media_assets` row (`mediaInfoFor`), so the producing tool has a real local file to open, never a URL to fetch.

## 2. Why it exists

crowsnest's value is upstream of production: it decides what to make and writes the script and the brief. It does not render video. The Reel Factory does. Something has to carry a chosen post from crowsnest into that producer without a human copying fields between two apps, and without the producer reaching into crowsnest's database directly. The MCP is that boundary: a typed, read-and-remix tool surface that any MCP client can call, so the handoff is a tool call rather than a manual export.

Running the server in-process, rather than as a second service with its own database handle, is the load-bearing decision. crowsnest is a single-user local app on one SQLite file, and SQLite tolerates exactly one writer. A separate MCP process would be a second connection and a second writer, racing the app's own writes. Mounting the server inside the app's Node process (`server.ts`) means the tools call the app's own query and service functions, so every read and write goes through the one connection the app already holds. The MCP never becomes a second writer.

## 3. Key concepts

| Concept | Description |
| --- | --- |
| Tool | One `crowsnest_*` capability registered on the server (`registerTool`), with a title, a description, a Zod input schema, and a handler. There are 19: seven read tools and twelve remix tools. |
| Result contract | Every handler returns through `result()` or `errorResult()`. `result(value)` surfaces the value both as pretty-printed JSON text and as `structuredContent`, and the two always agree because they come from one value. `errorResult(payload)` sets `isError: true` and carries a machine-readable payload instead of throwing across the MCP boundary. |
| Media info | For a video or a brief, `mediaInfoFor(assetId)` returns the stored asset's on-disk `path`, `byteSize`, and `durationSec`, read from the `media_assets` row. It never stats or reads the file and never throws; a null id or a missing row returns null, and an unresolvable stored path returns a null `path` rather than an error. This is what makes the handoff a local file, not an expiring URL. |
| Stateless transport | Each request builds a fresh server and a fresh streamable HTTP transport, torn down when the response closes (`http.ts`). No session bookkeeping; enough for a single local user driving tools. |
| Remix session | The one remix session per source video the remix tools read and advance. The MCP exposes the same session and the same service functions the remix dashboard uses; there is one session per video. |

## 4. How it fits in the system

The MCP sits at crowsnest's outer edge, between the app's data and an MCP client (the Reel Factory, or any other client). It reads through the feed, video, post-brief, vault, ideas, own-channel, and planned-posts queries, and it writes only through the remix service functions. It owns no tables of its own: it is a projection of what the other components already store. When a client calls `crowsnest_feed` then `crowsnest_video`, it is reading exactly what the dashboard reads; when it runs the remix tool chain, it is advancing exactly the session the remix page advances, and finishing a remix produces the same undated draft planned post the UI produces.

Because it is mounted in-process and stateless, the MCP has no background job, no lifecycle of its own, and nothing downstream depends on it staying up: it is a request surface. If it is not called, nothing else changes; the feed, analyze, and remix keep working through the UI regardless.

## 5. Dependency map

### Upstream (what the mcp depends on)

| Dependency | Why |
| --- | --- |
| Feed query (`src/server/queries/feed`) | Backs `crowsnest_feed`: the outlier feed with its filters and total count. |
| Video query (`src/server/queries/video`) | Backs `crowsnest_video`: one video with its analysis, transcript, and metrics. |
| Post brief query (`src/server/queries/post-brief`) | Backs `crowsnest_brief`: a planned post's title, source video, remix hook and beats, layout, and score. |
| Vault query (`src/server/queries/vault`) | Backs `crowsnest_scripts`: every saved script, newest first. |
| Ideas query (`src/server/queries/ideas`) | Backs `crowsnest_ideas`: the inbox or shortlist. |
| Own-channel queries (`src/server/queries/own-channel`) | Back `crowsnest_metrics`: the window overview and recent own posts. |
| Planned-posts query (`src/server/queries/planned-posts`) | Backs `crowsnest_plans`: dated intentions, optionally within a range. |
| Remix service (`src/server/services/remix`) | Backs all twelve remix tools: session, state, prompt, research, hooks, outline, variants, save, finish. |
| Media store (`src/server/media/store`) | `getAsset` and `resolveAssetPath` back `mediaInfoFor`, the media handoff for a video or brief. |
| The app's HTTP server (`server.ts`) | Routes `/api/mcp` to the MCP handler in-process, sharing the one SQLite connection. |

### Downstream (what depends on the mcp)

| Consumer | What it uses |
| --- | --- |
| Reel Factory (and any MCP client) | Calls the read tools to pick and pull a post, then the remix tools to shape a script; reads a video's or brief's media path to open the local file it will produce from. |

### External

| Dependency | Role |
| --- | --- |
| `@modelcontextprotocol/sdk` | The MCP server (`McpServer`) and the streamable HTTP transport the component is built on. |
| `zod` | The input schema for every tool. |

## 6. Boundaries

The mcp owns the tool surface: which tools exist, their inputs, the shape they return, and the guarantee that a failure comes back as a typed error result rather than a thrown exception. It owns the media handoff shape, `mediaInfoFor`, and its promise never to touch the file. It does not own the data: every value it returns is produced by a query or service function belonging to another component, and the MCP adds no business logic on top, so a rule about the feed, a brief, or a remix lives in that component, not here. It is not a second database connection or a second writer: it runs in-process precisely so that it is not. It does not authenticate or authorize callers beyond what the app's own local surface does; crowsnest is a single-user local app, and `/api/mcp` is served on the same loopback surface as the rest of the app.
