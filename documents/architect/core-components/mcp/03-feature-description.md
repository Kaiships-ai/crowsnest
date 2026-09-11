# mcp: feature description

The mcp component is crowsnest's tool surface for an MCP client. It has no screen of its own; its users are programs, not people at a screen. A client connects to `/api/mcp` and calls tools: seven that read crowsnest's data, eleven that drive the remix pipeline (keyless: no internal model call anywhere in that chain), nine monthly and weekly planning tools (four research reads, four sync-control tools, and one analysis write), and one that fetches and transcribes a video on demand, for twenty-eight in all. The whole surface is the handoff from crowsnest, which finds, analyzes, and remixes, to the tool that produces the finished reel, which opens the local media files the read tools point it at. This document describes those tools from the layer's own side: what each returns, how they group, and what the media handoff carries.

Every tool wraps a query or service function the dashboard already uses, so a tool returns exactly what the corresponding UI shows, and a remix driven through the tools advances exactly the session the remix page advances. Every tool returns through one contract: `result()` on success (JSON text and `structuredContent` that agree), `errorResult()` on a handled failure (an `isError` payload, never a thrown exception).

## 1. Feature summary

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Read crowsnest data | Seven read tools: feed, video, brief, scripts, ideas, metrics, plans. Metrics carries a prior-period comparison (`current`, `previous`, `posts`) | ● | `mcp-server.ts`, `src/server/queries/*` | none |
| 3 | Drive a remix | Eleven `crowsnest_remix_*` tools, session through finish, keyless (the three generate tools return a prompt, not a generation) | ● | `mcp-server.ts`, `src/server/services/remix` | none |
| 4 | Hand off media | `crowsnest_video` and `crowsnest_brief` return the stored media's on-disk path, size, and duration | ● | `mcp-server.ts` (`mediaInfoFor`), `src/server/media/store` | none |
| 5 | Research contract | Four read tools: `crowsnest_channels`, `crowsnest_channel_stats`, `crowsnest_research_set`, `crowsnest_outlier_pack`, each carrying the human's own reach benchmark beside competitor outliers | ● | `mcp-server.ts`, `src/server/queries/research`, `channels`, `own-channel` | none |
| 6 | Sync control | `crowsnest_sync_selected`, `crowsnest_sync_status`, `crowsnest_sync_cancel` drive a scoped channel sync | ● | `mcp-server.ts`, `src/server/actions/sync-actions` | none |
| 7 | Agent analysis | `crowsnest_save_analysis` writes an agent-authored analysis to `video_analyses` with `source = "mcp"` | ● | `mcp-server.ts`, `src/server/services/analyze` (`saveAgentAnalysis`), `src/server/llm/schemas` (`VideoAnalysisSchema`) | none |
| 8 | Transcribe on demand | `crowsnest_transcribe` fetches a video (downloading it from Instagram if not already stored) and returns its verbatim transcript, caching the result | ● | `mcp-server.ts`, `src/server/transcribe` (`getOrCreateTranscript`), `src/server/actions/media-actions` (`downloadVideoAction`) | none |

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
| `crowsnest_metrics` | `windowDays` (default 30), `limit` (default 20) | `{ current, previous, posts }` for the own channel, from the Graph API. `current` is the window overview; `previous` is the same-length window immediately before it, so the agent reads this period against the one before (month over month); `posts` is the recent measured own posts. Both windows come from `getOwnChannelOverview(windowDays, { offsetDays })`, `current` at offset 0 and `previous` at offset `windowDays`. Without an own channel set and a valid token, returns an error result with the reason and a hint. |
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

An MCP client steering a remix end to end with its own reasoning: Crowsnest is a deterministic data and action layer here, not a second model. The chain is keyless: no `ANTHROPIC_API_KEY`, no LLM proxy, anywhere in it. The read/write stages call the same service functions the dashboard uses, so a remix advanced through these tools and one advanced through the dashboard land in the same `remix_sessions` row; the three generate stages call a pure prompt-builder the dashboard's own generate functions were built from, not the model.

### What it does

Eleven tools drive the remix pipeline, one per step. There is one session per source video.

| Tool | Inputs | Returns / effect |
| --- | --- | --- |
| `crowsnest_remix_session` | `videoId` | Gets or creates the one session for a source video; returns the session state. |
| `crowsnest_remix_state` | `sessionId` | The current session state: topic, chosen hook, outline, variants, chosen variant. Null when unknown. |
| `crowsnest_remix_set_prompt` | `sessionId`, optional `topic`, `niche`, `targetLengthSec` | Sets only the given fields; returns the updated state. |
| `crowsnest_remix_research` | `sessionId` | Assembles research notes from the source analysis, transcript, and similar outliers. No model call. |
| `crowsnest_remix_hooks` | `sessionId`, optional `vaultItemId`, `steer` | Returns `{ system, user, context }`, the Hooks stage's assembled prompt. No model call. The calling agent writes the hook options itself; optionally seeds the prompt from a vault hook or steers it with a note. |
| `crowsnest_remix_choose_hook` | `sessionId`, `hook` | Sets the chosen hook by text (the agent's own text, or one it wrote from `crowsnest_remix_hooks`); returns `{ ok, chosenHook }`. |
| `crowsnest_remix_style` | `sessionId`, optional `styleVaultItemId` | Sets the style vault item, or clears it (omit the id) to use the source video's own structure. |
| `crowsnest_remix_outline` | `sessionId`, optional `steer`, optional `outline` | Bidirectional, like `crowsnest_remix_hooks` plus `crowsnest_remix_choose_hook` folded into one tool. With no `outline`: returns `{ system, user, context }`, the Outline stage's assembled prompt from the chosen hook and style. No model call. With `outline` (the agent's own `{ beats: [{ label, content, targetSec }] }`): persists it onto the session via `updateStage` and returns `{ ok, outline }`. |
| `crowsnest_remix_variants` | `sessionId`, optional `steer` | Returns `{ system, user, context }`, the Script stage's assembled prompt from the chosen hook and the session's saved outline. No model call. `context.angles` lists the fixed per-take angles the in-app path used to vary multiple takes, for an agent that wants more than one script to choose between. |
| `crowsnest_remix_save_script` | `sessionId`, `title`, `script` | Saves the agent's own `script` text as this session's script and records it as the chosen result; returns `{ ok, scriptId }`. |
| `crowsnest_remix_finish` | `sessionId` | Finishes the session: creates or reuses an undated draft planned post carrying the chosen script, and returns its `postId`. Idempotent. |

`crowsnest_remix_regenerate_variant` is retired (P0 slice 2b): there is no crowsnest-generated variant left to regenerate. An agent wanting another take just calls `crowsnest_remix_variants` again, optionally with a different `steer`.

### How to access it

Over `/api/mcp`, as MCP tool calls. A typical run: read the feed, open a video, create a session for it, set the prompt, build research, fulfill the hooks prompt and choose a hook, pick a style, fulfill the outline prompt and save the outline back (calling `crowsnest_remix_outline` a second time, now with `outline`), fulfill the script prompt and save the script, and finish, ending with a draft planned post whose brief the producer reads back through `crowsnest_brief`. Skipping the outline save-back leaves the script prompt with no beats in it, since `crowsnest_remix_variants` reads the session's saved outline.

### Business rules

- One session per source video: `crowsnest_remix_session` gets the existing one or creates it.
- Stage progression on the session is left to the service functions; the tools do not manage the dashboard's stepper, which only affects how the UI renders the session.
- `crowsnest_remix_finish` is idempotent: it creates or reuses one undated draft planned post, so calling it twice does not make two.
- The three prompt tools (`hooks`, `outline`, `variants`) assemble exactly what the in-app generate functions would send to the model (same system prompt, same builder, same session fields) and return it instead of calling `getLlm`; no proxy state or key affects them.
- `crowsnest_remix_outline` is the one prompt tool with a save-back path on the same name: passing `outline` skips prompt assembly entirely and persists the given outline via `updateStage`, the same column `generateOutline` writes on the in-app path.

### Limitations

- `crowsnest_remix_save_script` trusts the caller's `script` text as is; there is no length or format check beyond it being a string.
- There is no built-in way for the agent to compare multiple script takes side by side inside crowsnest: unlike the in-app path's three stored `variants`, the keyless path saves one script at a time, so producing more than one take means calling `crowsnest_remix_variants` more than once (with a different `context.angles` entry appended, or a different `steer`) and choosing which text to save.

### User guide

There is no screen for this; a client drives the remix, writing every generated word itself from the prompts crowsnest hands back. Pointed at a source video, an MCP client can carry a remix from research through a chosen hook, an outline, and a script it wrote, save it, and finish, which leaves crowsnest with a draft planned post ready to produce, the same shape of result the remix page produces by hand, with no crowsnest-side model call anywhere in the path.

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

## 5. Research contract

The read surface an agent uses to plan a month and refresh a week. The agent reads the tracked channels and their baselines, pulls a broad reading bundle and a tight shortlist, and reads every candidate against both the competitor's outlier score and the human's own reach at once. The dashboard shows the same channel and outlier data through the same queries.

### Who uses it

An MCP client planning content. The dashboard shows the same channel and outlier data through the same query functions.

### What it does

Four read tools, each returning through `result()` over its backing query.

| Tool | Inputs | Returns |
| --- | --- | --- |
| `crowsnest_channels` | none | `{ channels }`: the tracked channels and their fleets. Backed by `getChannelsList`. |
| `crowsnest_channel_stats` | `channelId` | `{ detail, basis, lastRun }`: one channel's detail and baseline (`getChannelDetail`), its median basis (`getChannelMedianBasis`), and the last sync run's health (`getLastRunHealth`). An unknown id returns `errorResult({ error: "not found", channelId })`. |
| `crowsnest_research_set` | `minScore`, `sinceDays`, `query`, `limit` (default 24), all optional | `{ outliers, ownBenchmark }`: the top outliers by score, each joined to its `video_analyses` row (or null), plus the own benchmark block of `reachIndex` rows, so each candidate reads against both baselines. Backed by `getResearchSet` in `src/server/queries/research.ts`, which calls `getOutlierFeed` and `getOwnPosts`. |
| `crowsnest_outlier_pack` | `limit` (default 8), `sinceDays`, `rising` (boolean), all optional | `{ items, ownBenchmark }`: a tight shortlist ready to act on, each item carrying its `media` and `thumbnail` handoff (via `mediaInfoFor`) and the same own benchmark block. With `rising = true` and a short `sinceDays`, it ranks by recency (the feed's `recent` sort) so a launch surge surfaces for the weekly refresh; otherwise by score. Backed by `getOutlierPack`. |

### How to access it

Over `/api/mcp`, as MCP tool calls. There is no crowsnest screen for these tools; the dashboard reads the same channel and outlier data through the same query functions.

### Business rules

- Own performance and competitor performance are different units. The human's posts score on `reachIndex` (reach over the human's own median reach); competitors score on `outlierScore` (views over the competitor's own baseline). `research_set` and `outlier_pack` return both, the outliers on one side and the `ownBenchmark` block on the other, rather than collapsing them into one number.
- Rising mode on `outlier_pack` orders by recency over the `sinceDays` window, so this week's fresh high-scoring videos rank first. It is a recency proxy; there is no separate velocity metric. Naming the event, a specific product launch, is the agent's world knowledge, not crowsnest's.
- Each tool is a thin wrapper over queries the dashboard already uses, so any data rule (what counts as an outlier, how a baseline is computed) lives in that component, not here. `getResearchSet` and `getOutlierPack` re-use `getOutlierFeed` rather than re-implementing the feed SQL.

### Limitations

- `getLastRunHealth` returns the last sync run overall, not a run scoped to the requested channel, so `channel_stats.lastRun` reflects the most recent sync of any channel. Called out in [backlog to enhance](05-backlog-to-enhance.md).
- Rising mode ranks by recency alone; a true velocity signal (views per day since posting) is not computed. Called out in [backlog to enhance](05-backlog-to-enhance.md).
- The own benchmark block's `reachIndex` is null until enough measured own posts exist to form a median, so a fresh own channel returns rows with null reach.

### User guide

These tools are for a program, not a person, so there is no screen to walk through. An MCP client pointed at crowsnest can list the tracked channels, read one channel's baseline and last sync health, pull a broad research bundle for a theme, and pull a tight shortlist to act on, always reading each competitor outlier beside the human's own comparable reach, and, in rising mode, catch a surge fast enough for a weekly plan to react.

## 6. Sync control

### Who uses it

An MCP client that needs to freshen the channels it plans from before it reads them. The dashboard triggers the same syncs through the same server actions.

### What it does

Three tools, thin wrappers over the existing sync actions. Each backing action already returns a result object, so these tools never throw across the MCP boundary.

| Tool | Inputs | Returns / effect |
| --- | --- | --- |
| `crowsnest_sync_selected` | `channelIds` (non-empty array) | Starts a sync scoped to the given channels and returns `{ jobId }`. An empty or absent array returns `errorResult({ error: "channelIds must be a non-empty array", code: "NO_CHANNELS" })`; there is no library-wide default. Backed by `startSyncAction`. |
| `crowsnest_sync_status` | `jobId` | `{ progress }`: the run's progress, or `null` progress when the id names no run. A null progress for an unknown job is not an error. Backed by `getSyncProgressAction`. |
| `crowsnest_sync_cancel` | `jobId` | `{ ok, jobId, requested }`: cooperative cancel. `requested` is false when there was nothing still running under that id. Backed by `cancelSyncAction`. |

### How to access it

Over `/api/mcp`, as MCP tool calls.

### Business rules

- `crowsnest_sync_selected` requires a non-empty `channelIds` array; unlike the dashboard's whole-library sync, the tool refuses an empty or absent call (code `NO_CHANNELS`) rather than syncing everything.
- `crowsnest_sync_status` treats an unknown job id as null progress, not a failure, so a caller polling a finished or invalid job reads a null rather than an error.
- Cancel is cooperative: `cancelSyncAction` requests a stop at the next channel boundary and keeps committed work; `requested` reports whether anything was actually running to cancel. It does not kill the run mid-request.
- These tools trigger real Instagram traffic through the sidecar, the same path the dashboard's sync uses, so they add no new trust boundary.

### Limitations

- The tools own no sync logic; scoping, progress, and cancellation all live in `sync-actions.ts`.

### User guide

There is no screen for this. An MCP client can start a sync scoped to just the channels it is about to plan from, poll the job for progress, and cancel it, without touching the whole library.

## 7. Agent analysis

### Who uses it

An MCP client that is itself the model. When a strong outlier has no analysis, the agent writes one and saves it, so its taste becomes durable crowsnest data that Remix and Ideas then read unchanged.

### What it does

One write tool.

| Tool | Inputs | Returns / effect |
| --- | --- | --- |
| `crowsnest_save_analysis` | `videoId`, plus the analysis fields flat: `hookType`, `structureSegments`, `formatTags`, `styleTags`, `whyItWorked` | `{ ok: true, videoId }` on success. The tool passes the fields to `saveAgentAnalysis`, which validates them against `VideoAnalysisSchema` and upserts the `video_analyses` row with `source = "mcp"`. No in-app LLM call. An unknown video id or fields that fail validation return `errorResult({ error, videoId })` and write nothing. |

The analysis fields are the ones `VideoAnalysisSchema` defines: `hookType`, `structureSegments` (each beat `{ label, startSec, endSec, note, transcript }`), `formatTags`, `styleTags`, and `whyItWorked`. There is no `summary` field on the tool; the schema does not carry one.

### How to access it

Over `/api/mcp`, as an MCP tool call.

### Business rules

- The agent is the model: there is no in-app LLM call, the tool only validates and stores what the agent already wrote.
- Fields that fail `VideoAnalysisSchema` validation come back as an error result, not a partial write. An unknown `videoId` returns `{ error: "video not found" }` and writes nothing.
- The row is stamped `source = "mcp"`, distinguishing agent-authored analyses from in-app ones. The `source` column on `video_analyses` is nullable text (values `mcp`, `auto`, `manual`, or `legacy` for rows written before the column existed); it shipped in migration `0027`, which backfills existing rows to `legacy`.
- A second save for the same video updates the existing row in place rather than inserting a new one; there is one `video_analyses` row per video.
- Remix (`describeSourceStructure`) and Ideas read the same `video_analyses` table, so they consume the agent artifact with no change.

### Limitations

- It writes one analysis per call for one video; there is no batch write.

### User guide

There is no screen for this. When an MCP client finds a strong outlier with no analysis, it can write the analysis itself and save it into crowsnest, after which the remix and ideas flows read that analysis exactly as they read an analysis produced in the app.

## 7b. Content artifacts (`crowsnest_save_artifact`, `crowsnest_artifacts`)

### What it does

Persists and reads back the larger, cross-video artifacts the content machine produces:
angles, an outlier library, an idea bank, a Week 01 to 04 monthly plan, and briefs. The
agent authors the artifact; crowsnest stores it as the source of truth with provenance and
returns it. Keyless: nothing here calls a model. `crowsnest_save_artifact` creates one (or
updates it in place when given an `id`); `crowsnest_artifacts` lists them newest first,
optionally by kind, or fetches one by id.

### How to access it

Over `/api/mcp`, as MCP tool calls.

### Business rules

- The agent is the model. The tool validates the input against a schema and stores it; it
  never generates content. `kind` must be one of angles, outlier_library, idea_bank,
  monthly_plan, or brief, and `title`, `data`, and `agent` are required.
- `data` is the agent's own JSON; crowsnest stores and returns it verbatim, imposing no
  per-kind schema, so artifact shapes can evolve without a migration.
- Provenance is first class: each row stamps `agent`, `model`, `sourceVideoIds`, and
  `assumptions`, plus created and updated timestamps.
- One artifact can hold many items, so an idea bank of 100 or more ideas is a single row,
  not one row per idea (the flat `idea` table's one-per-video cap does not apply).

### Data model

A new `content_artifacts` table (migration `0028`), owned by the content-artifacts service
(`src/server/services/artifacts.ts`), not by MCP. `kind` is validated at the service
boundary, not by a DB constraint.

### User guide

The dashboard's content-pipeline section reads these back and shows each artifact with its
kind and provenance, so the app reflects what the agent produced. Reading the full content
of an artifact is an MCP call (`crowsnest_artifacts`), which is the intended path: the agent
that wrote it, or a later agent run, reads it back over MCP.

## 7c. Transcribe a video on demand (`crowsnest_transcribe`)

### Who uses it

An MCP client that wants a video's verbatim words to ground an analysis, on a post that has no transcript yet. `crowsnest_video` only returns a transcript when a `transcripts` row already exists, and nothing else creates one: sync downloads thumbnails, never video bytes, and the auto-analyze pass that once transcribed was retired in P0 slice 2a. This is the one tool that produces a transcript on request.

### What it does

One action tool.

| Tool | Inputs | Returns / effect |
| --- | --- | --- |
| `crowsnest_transcribe` | `videoId` (required, from a feed item) | `{ videoId, text, source, cached }`. Fetches the video if it is not already stored (`downloadVideoAction`, which re-resolves a fresh Instagram URL and downloads the bytes), then runs the cache-first whisper.cpp then Groq chain (`getOrCreateTranscript`) and persists the row. `cached` is true when a `transcripts` row already existed, so a repeat call returns instantly without a provider run. A photo or carousel with no downloadable video, an unknown id, an unreachable sidecar, or no available transcript provider all return `errorResult({ error, videoId })`. |

### How to access it

Over `/api/mcp`, as an MCP tool call. In the flow, it slots between reading a video and authoring its analysis: call `crowsnest_transcribe(videoId)`, then `crowsnest_video(videoId)` returns the now-stored transcript, then `crowsnest_save_analysis`.

### Business rules

- The download step is idempotent: `downloadVideoAction` returns the existing asset id when the video is already stored, so it only pays the Instagram round-trip once per video.
- Transcription is cache-first: the second call for a video returns the stored row with `cached: true`, never re-running a provider.
- It needs a live IG sidecar session to download a video for the first time, and at least one available transcript provider (local whisper.cpp, or `GROQ_API_KEY` for Groq) to transcribe one. Either being absent is a handled error result, not a thrown exception.

### Limitations

- It transcribes one video per call; there is no batch form.
- A first transcription is a real, potentially slow round-trip (download plus a provider run); only the cached path is instant.

### User guide

There is no screen for this. When a client finds a strong outlier with no transcript, it can ask crowsnest to fetch and transcribe it, then read the words back through `crowsnest_video` to ground its analysis, the same transcript any other path would surface.

## 8. Interactions with other systems

Data ownership. The MCP owns no tables. Every value it returns is produced by a query or service function belonging to the feed, analyze, remix, vault, ideas, own-channel, planned-posts, or media components, so a rule about any of that data lives in that component, not here.

The single connection. The server runs in-process (`server.ts` routes `/api/mcp` to it), so every tool call reads and writes through the app's one SQLite connection. There is no second connection and no second writer.

The LLM proxy. The four generate remix tools call the model through the same proxy the remix dashboard uses; with the proxy down they fail as the dashboard's generation does, while the read tools and the non-generating remix tools keep working. See [llm](../llm/01-concept-brief.md).

Errors. A handled failure is an error result the caller reads, never a thrown exception. Only an unexpected throw in the transport becomes a JSON-RPC 500, caught and rendered as an envelope in `handleMcpRequest`.

## 9. Edge cases

- **No credential on the endpoint.** `handleMcpRequest` performs no auth; any local process that can reach the bound interface can call the tools. The trust boundary is which interface `server.ts` binds, recorded in [test cases](04-test-cases.md#4-security-lite).
- **The proxy is down.** The generate remix tools return an error; the read tools and the non-generating remix tools are unaffected.
- **An unknown id.** `crowsnest_video`, `crowsnest_brief`, `crowsnest_transcribe`, and the save/state remix tools return an error result naming the missing id or session, not a thrown exception.
- **Transcribe with no provider or a dead sidecar.** `crowsnest_transcribe` returns an error result (the download failure, or `no transcript provider available` with a per-provider reason), never a thrown exception; a photo or carousel with no downloadable video is the same handled error.
- **A large list.** `crowsnest_scripts` and `crowsnest_ideas` read the whole list before slicing; on a local vault this is fine, but it is the known ceiling in [backlog to enhance](05-backlog-to-enhance.md).
- **A missing media file.** A null asset id or an unresolvable stored path yields a null media block or a null `path`, never an error; the producer sees the absence rather than a failure.
