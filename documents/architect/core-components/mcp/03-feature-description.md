# mcp: feature description

The mcp component is crowsnest's tool surface for an MCP client. It does not have a page; its users are programs, not people at a screen. A client connects to `/api/mcp` and calls tools: seven that read crowsnest's data and twelve that drive the remix pipeline. The whole surface is the handoff from crowsnest, which finds, analyzes, and remixes, to the tool that produces the finished reel, which opens the local media files the read tools point it at.

Every tool wraps a query or service function the dashboard already uses, so a tool returns exactly what the corresponding UI shows, and a remix driven through the tools advances exactly the session the remix page advances. Every tool returns through one contract: `result()` on success (JSON text and `structuredContent` that agree), `errorResult()` on a handled failure (an `isError` payload, never a thrown exception).

## 1. Feature summary

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in |
| --- | --- | --- | --- | --- |
| 2 | Read the outlier feed | `crowsnest_feed`: filtered, sorted, paged outliers with a total count | ● | `mcp-server.ts`, `queries/feed` |
| 3 | Read one video | `crowsnest_video`: a video with analysis, transcript, metrics, and media paths | ● | `mcp-server.ts`, `queries/video` |
| 4 | Read a post brief | `crowsnest_brief`: a planned post's brief with its source video's media | ● | `mcp-server.ts`, `queries/post-brief` |
| 5 | List scripts, ideas, metrics, plans | Four read tools over the vault, ideas, own-channel, and planned posts | ● | `mcp-server.ts`, `queries/*` |
| 6 | Drive a remix | The twelve `crowsnest_remix_*` tools, session through finish | ● | `mcp-server.ts`, `services/remix` |

## 2. Read tools

Seven tools read crowsnest's data. Inputs are optional unless noted.

### crowsnest_feed

The outlier feed: top videos from tracked channels, ranked. Inputs (all optional): `minScore`, `minViews`, `sinceDays`, `followerBand` (`nano` | `mid` | `macro`), `query` (free text over caption and channel), `analyzed` (`yes` | `no`), `sort` (`score` | `recent` | `views`, default `score`), `limit` (default 24), `offset` (default 0). Returns `{ total, count, items }`: `total` is the full match count, `count` and `items` are the page. Pagination goes through the feed query's own SQL `limit`/`offset`.

### crowsnest_video

One video with its analysis, transcript, and metrics, by `videoId` (required, from a feed item). Returns the video detail plus `media` and `thumbnail`, each the stored asset's `{ path, byteSize, durationSec }` from `mediaInfoFor`. An unknown id returns an error result `{ error: "not found", videoId }`.

### crowsnest_brief

The brief for a planned post: its title, source video, remix hook and beats, layout, and score, by `postId` (required, from `crowsnest_plans`). When the brief has a source video, that video carries its own `media` and `thumbnail` paths. An unknown id returns an error result `{ error: "not found", postId }`.

### crowsnest_scripts

Every saved script, newest first. A script is the text a remix produced. Inputs: `limit` (default 50), `offset` (default 0). Returns `{ total, count, items }`. The slice is in memory over the full list.

### crowsnest_ideas

The ideas inbox or shortlist: short concepts generated from videos, for the weekly plan. Inputs: `tab` (`inbox` | `shortlist`, default `inbox`), `limit` (default 50), `offset` (default 0). Returns `{ total, count, items }`, sliced in memory within the requested tab.

### crowsnest_metrics

How the user's own channel is doing: a window overview plus recent measured own posts, from the Graph API. Inputs: `windowDays`, `limit` (default 20). Returns `{ overview, posts }`. Needs an own channel set and a valid Graph token; without them it returns an error result carrying the message and the hint to set an own channel and a valid Graph token.

### crowsnest_plans

Planned posts, dated intentions to publish on the own channel, optionally within a date range. Inputs: `from` and `to` (`YYYY-MM-DD`, inclusive); a range applies only when both are given. Returns the planned posts. This tool is read-only: it lists plans and never creates or changes one. The only planned post the MCP ever writes is the draft `crowsnest_remix_finish` produces.

## 3. Remix tools

Twelve tools drive the remix pipeline, one per step, so a client can steer each stage. They call the same remix service functions the dashboard uses. There is one session per source video. The generate tools (hooks, outline, variants, regenerate) need the LLM proxy; the others do not.

| Tool | Inputs | Returns / effect |
| --- | --- | --- |
| `crowsnest_remix_session` | `videoId` | Gets or creates the one session for a source video; returns the session state. |
| `crowsnest_remix_state` | `sessionId` | The current session state: topic, chosen hook, outline, variants, chosen variant. Null when unknown. |
| `crowsnest_remix_set_prompt` | `sessionId`, optional `topic`, `niche`, `targetLengthSec` | Sets only the given fields on the session; returns the updated state. |
| `crowsnest_remix_research` | `sessionId` | Assembles research notes from the source analysis, transcript, and similar outliers. No model call, so it works with the proxy down. |
| `crowsnest_remix_hooks` | `sessionId`, optional `vaultItemId`, `steer` | Generates hook options. Needs the proxy. Optionally seeds from a vault hook or steers with a note. |
| `crowsnest_remix_choose_hook` | `sessionId`, `hook` | Sets the chosen hook by text (a generated one or the caller's own); returns `{ ok, chosenHook }`. |
| `crowsnest_remix_style` | `sessionId`, optional `styleVaultItemId` | Sets the style vault item, or clears it (omit the id) to use the source video's own structure. |
| `crowsnest_remix_outline` | `sessionId`, optional `steer` | Generates the beat outline from the chosen hook and style. Needs the proxy. |
| `crowsnest_remix_variants` | `sessionId`, optional `steer` | Generates script variants (three by default). Needs the proxy. A failed variant comes back as an error at its slot. |
| `crowsnest_remix_regenerate_variant` | `sessionId`, `index`, optional `steer` | Regenerates one variant slot by zero-based index, keeping the others. Needs the proxy. |
| `crowsnest_remix_save_script` | `sessionId`, `variantIndex`, `title` | Saves one variant as a script and records it as the chosen variant; returns `{ ok, scriptId }`. Errors if the session or the variant text is missing. |
| `crowsnest_remix_finish` | `sessionId` | Finishes the session: creates or reuses an undated draft planned post carrying the chosen script, and returns its `postId`. Idempotent. |

A typical client run reads the feed, opens a video, creates a session for it, sets the prompt, builds research, generates and chooses a hook, picks a style, generates an outline and variants, saves one, and finishes, ending with a draft planned post whose brief the producer can then read back through `crowsnest_brief`.

## 4. The media handoff

The read tools are what make the handoff a local file rather than a URL. `crowsnest_video` and `crowsnest_brief` return, for each media asset, the on-disk `path`, the `byteSize`, and the `durationSec`, all read from the stored `media_assets` row. The MCP never stats or reads the file: the numbers are the ones the app recorded when it downloaded the asset. A producer calling these tools gets a path it can open directly. A missing asset returns a null media block, and an unresolvable stored path returns a null `path`, never an error.

## 5. Interactions with other systems

Data ownership. The MCP owns no tables. Every value it returns is produced by a query or service function belonging to the feed, analyze, remix, vault, ideas, own-channel, planned-posts, or media components, so a rule about any of that data lives in that component, not here.

The single connection. The server runs in-process (`server.ts` routes `/api/mcp` to it), so every tool call reads and writes through the app's one SQLite connection. There is no second connection and no second writer.

The LLM proxy. The four generate tools call the model through the same proxy the remix dashboard uses; with the proxy down they fail as the dashboard's generation does, while the read tools and the non-generating remix tools keep working.

Errors. A handled failure is an error result the caller reads, never a thrown exception. Only an unexpected throw in the transport becomes a JSON-RPC 500, caught and rendered as an envelope in `handleMcpRequest`.

## 6. Limitations

- `crowsnest_scripts` and `crowsnest_ideas` slice in memory over the full list; the query functions take no pagination arguments. Fine for a local vault, called out in [backlog to enhance](05-backlog-to-enhance.md).
- The server is stateless and single-user: there is no session, no auth beyond the app's own local surface, and no cross-request state in the server itself.
- The generate remix tools need the LLM proxy; without it they return an error, the same as the dashboard.
