# mcp: feature description

The mcp component is crowsnest's tool surface for an MCP client. It has no screen of its own; its users are programs, not people at a screen. A client connects to `/api/mcp` and calls tools: seven that read crowsnest's data and twelve that drive the remix pipeline. The whole surface is the handoff from crowsnest, which finds, analyzes, and remixes, to the tool that produces the finished reel, which opens the local media files the read tools point it at. This document describes those tools from the layer's own side: what each returns, how they group, and what the media handoff carries.

Every tool wraps a query or service function the dashboard already uses, so a tool returns exactly what the corresponding UI shows, and a remix driven through the tools advances exactly the session the remix page advances. Every tool returns through one contract: `result()` on success (JSON text and `structuredContent` that agree), `errorResult()` on a handled failure (an `isError` payload, never a thrown exception).

## 1. Feature summary

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Read crowsnest data | Seven read tools: feed, video, brief, scripts, ideas, metrics, plans | ● | `mcp-server.ts`, `src/server/queries/*` | none |
| 3 | Drive a remix | Twelve `crowsnest_remix_*` tools, session through finish | ● | `mcp-server.ts`, `src/server/services/remix` | none |
| 4 | Hand off media | `crowsnest_video` and `crowsnest_brief` return the stored media's on-disk path, size, and duration | ● | `mcp-server.ts` (`mediaInfoFor`), `src/server/media/store` | none |

## 2. Read crowsnest data

### Who uses it

An MCP client. In practice the Reel Factory, or any other MCP client, calling `/api/mcp` to browse and pull crowsnest's data before or during production. There is no human-facing screen for these tools; the dashboard reads the same data through the same query functions.

### What it does

Seven tools read crowsnest's data. Inputs are optional unless noted; each returns through `result()`.

| Tool | Inputs | Returns |
| --- | --- | --- |
| `crowsnest_feed` | `minScore`, `minViews`, `sinceDays`, `followerBand` (`nano` \| `mid` \| `macro`), `query`, `analyzed` (`yes` \| `no`), `sort` (`score` \| `recent` \| `views`, default `score`), `limit` (default 24), `offset` (default 0) | `{ total, count, items }`: the full match count, then the page. Pagination goes through the feed query's own SQL `limit`/`offset`. |
| `crowsnest_video` | `videoId` (required, from a feed item) | The video detail plus `media` and `thumbnail` (see feature 4). Unknown id returns `errorResult({ error: "not found", videoId })`. |
| `crowsnest_brief` | `postId` (required, from `crowsnest_plans`) | A planned post's brief: title, source video, remix hook and beats, layout, score. The source video carries its own media. Unknown id returns `errorResult({ error: "not found", postId })`. |
| `crowsnest_scripts` | `limit` (default 50), `offset` (default 0) | `{ total, count, items }`: every saved script, newest first, sliced in memory over the full list. |
| `crowsnest_ideas` | `tab` (`inbox` \| `shortlist`, default `inbox`), `limit` (default 50), `offset` (default 0) | `{ total, count, items }`: the ideas in the requested tab, sliced in memory. |
| `crowsnest_metrics` | `windowDays`, `limit` (default 20) | `{ overview, posts }` for the own channel, from the Graph API. Without an own channel set and a valid token, returns an error result with the reason and a hint. |
| `crowsnest_plans` | `from`, `to` (`YYYY-MM-DD`, inclusive; a range applies only when both are given) | Planned posts, optionally within the range. |

### How to access it

Over `/api/mcp`, as an MCP tool call. The client lists tools, then calls one by name with its arguments. Nothing in the crowsnest UI invokes these tools; they are the client's surface, not a page.

### Business rules

- `crowsnest_plans` is read-only: it lists planned posts but never creates or changes one. The only planned post the MCP writes is the draft `crowsnest_remix_finish` produces.
- `crowsnest_feed` paginates in SQL through the feed query; `crowsnest_scripts` and `crowsnest_ideas` slice in memory because their query functions take no pagination arguments.
- A handled failure (an unknown id, metrics with no own channel) is an error result the caller reads, never a thrown exception.

### Limitations

- The in-memory slice on `crowsnest_scripts` and `crowsnest_ideas` reads the whole list before paging; fine for a local vault, called out in [backlog to enhance](05-backlog-to-enhance.md).
- These tools add no logic over their backing queries, so any data rule (what counts as an outlier, how a brief is shaped) lives in that component, not here.

### User guide

These tools are for a program, not a person, so there is no screen to walk through. An MCP client pointed at crowsnest can browse the outlier feed, open any video with its analysis and metrics, read a planned post's brief, and list saved scripts, ideas, own-channel metrics, and planned posts, all reading exactly what the crowsnest dashboard shows for the same data.

## 3. Drive a remix

### Who uses it

An MCP client steering a remix, one step at a time. The same twelve service functions back the remix page, so a remix advanced through these tools and one advanced through the dashboard are the same session.

### What it does

Twelve tools drive the remix pipeline, one per step. There is one session per source video. The generate tools (hooks, outline, variants, regenerate) need the LLM proxy; the others do not.

| Tool | Inputs | Returns / effect |
| --- | --- | --- |
| `crowsnest_remix_session` | `videoId` | Gets or creates the one session for a source video; returns the session state. |
| `crowsnest_remix_state` | `sessionId` | The current session state: topic, chosen hook, outline, variants, chosen variant. Null when unknown. |
| `crowsnest_remix_set_prompt` | `sessionId`, optional `topic`, `niche`, `targetLengthSec` | Sets only the given fields; returns the updated state. |
| `crowsnest_remix_research` | `sessionId` | Assembles research notes from the source analysis, transcript, and similar outliers. No model call, so it works with the proxy down. |
| `crowsnest_remix_hooks` | `sessionId`, optional `vaultItemId`, `steer` | Generates hook options. Needs the proxy. Optionally seeds from a vault hook or steers with a note. |
| `crowsnest_remix_choose_hook` | `sessionId`, `hook` | Sets the chosen hook by text; returns `{ ok, chosenHook }`. |
| `crowsnest_remix_style` | `sessionId`, optional `styleVaultItemId` | Sets the style vault item, or clears it (omit the id) to use the source video's own structure. |
| `crowsnest_remix_outline` | `sessionId`, optional `steer` | Generates the beat outline from the chosen hook and style. Needs the proxy. |
| `crowsnest_remix_variants` | `sessionId`, optional `steer` | Generates script variants (three by default). Needs the proxy. A failed variant comes back as an error at its slot. |
| `crowsnest_remix_regenerate_variant` | `sessionId`, `index`, optional `steer` | Regenerates one variant slot by zero-based index, keeping the others. Needs the proxy. |
| `crowsnest_remix_save_script` | `sessionId`, `variantIndex`, `title` | Saves one variant as a script and records it as the chosen variant; returns `{ ok, scriptId }`. Errors if the session or variant text is missing. |
| `crowsnest_remix_finish` | `sessionId` | Finishes the session: creates or reuses an undated draft planned post carrying the chosen script, and returns its `postId`. Idempotent. |

### How to access it

Over `/api/mcp`, as MCP tool calls. A typical run: read the feed, open a video, create a session for it, set the prompt, build research, generate and choose a hook, pick a style, generate an outline and variants, save one, and finish, ending with a draft planned post whose brief the producer reads back through `crowsnest_brief`.

### Business rules

- One session per source video: `crowsnest_remix_session` gets the existing one or creates it.
- Stage progression on the session is left to the service functions; the tools do not manage the dashboard's stepper, which only affects how the UI renders the session.
- `crowsnest_remix_finish` is idempotent: it creates or reuses one undated draft planned post, so calling it twice does not make two.
- The generate tools call the model through the same proxy the dashboard uses; with the proxy down they fail exactly as the dashboard's generation does.

### Limitations

- The four generate tools need the LLM proxy; without it they return an error, not a partial result.
- `crowsnest_remix_save_script` returns an error result rather than throwing when the session is unknown or there is no variant text at the given index.

### User guide

There is no screen for this; a client drives the remix. Pointed at a source video, an MCP client can carry a remix from research through a chosen hook, an outline, and script variants, save the one it wants, and finish, which leaves crowsnest with a draft planned post ready to produce, the same result the remix page produces by hand.

## 4. Hand off media

### Who uses it

The producing client, when it needs the actual video or thumbnail file behind a feed item or a brief. It reaches this through `crowsnest_video` and `crowsnest_brief`, which enrich their result with media info.

### What it does

For each media asset on a video or brief, the tool returns `mediaInfoFor(assetId)`: the on-disk `path`, the `byteSize`, and the `durationSec`, all read from the stored `media_assets` row. `crowsnest_video` returns both `media` (the video asset) and `thumbnail`; `crowsnest_brief` returns the same pair nested under its source video. The MCP never stats or reads the file: the numbers are the ones the app recorded when it downloaded the asset.

### How to access it

There is no separate tool; the media block comes back inside `crowsnest_video` and `crowsnest_brief`. A client reads `result.media.path` (and `thumbnail.path`) to open the local file.

### Business rules

- A null or missing asset id returns a null media block, not an error.
- An unresolvable stored path returns a null `path` inside the block, again not an error.
- `mediaInfoFor` never throws across the MCP boundary.

### Limitations

- The path is only as current as the app's own download: if a video was never fetched (on-demand video is downloaded on first play), `media.path` reflects whatever the row holds, which may be a thumbnail-only asset set.
- The handoff gives a local path, not a stream; the producer opens the file itself.

### User guide

Nothing to walk through for a person: when a client asks crowsnest for a video or a brief, it gets back where the video and thumbnail files actually live on the machine, along with their size and duration, so the tool that produces the reel opens a real local file instead of a link that would expire.

## 5. Interactions with other systems

Data ownership. The MCP owns no tables. Every value it returns is produced by a query or service function belonging to the feed, analyze, remix, vault, ideas, own-channel, planned-posts, or media components, so a rule about any of that data lives in that component, not here.

The single connection. The server runs in-process (`server.ts` routes `/api/mcp` to it), so every tool call reads and writes through the app's one SQLite connection. There is no second connection and no second writer.

The LLM proxy. The four generate remix tools call the model through the same proxy the remix dashboard uses; with the proxy down they fail as the dashboard's generation does, while the read tools and the non-generating remix tools keep working. See [llm](../llm/01-concept-brief.md).

Errors. A handled failure is an error result the caller reads, never a thrown exception. Only an unexpected throw in the transport becomes a JSON-RPC 500, caught and rendered as an envelope in `handleMcpRequest`.

## 6. Edge cases

- **No credential on the endpoint.** `handleMcpRequest` performs no auth; any local process that can reach the bound interface can call the tools. The trust boundary is which interface `server.ts` binds, recorded in [test cases](04-test-cases.md#4-security-lite).
- **The proxy is down.** The generate remix tools return an error; the read tools and the non-generating remix tools are unaffected.
- **An unknown id.** `crowsnest_video`, `crowsnest_brief`, and the save/state remix tools return an error result naming the missing id or session, not a thrown exception.
- **A large list.** `crowsnest_scripts` and `crowsnest_ideas` read the whole list before slicing; on a local vault this is fine, but it is the known ceiling in [backlog to enhance](05-backlog-to-enhance.md).
- **A missing media file.** A null asset id or an unresolvable stored path yields a null media block or a null `path`, never an error; the producer sees the absence rather than a failure.
