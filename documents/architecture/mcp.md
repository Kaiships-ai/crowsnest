# MCP

The MCP server runs inside crowsnest's own process at `/api/mcp` and exposes the app's data and its remix pipeline as 30 `crowsnest_*` tools. Crowsnest is the data and action brain, the calling agent (Claude, Codex, the Reel Factory) is the only reasoning brain, and no tool calls an internal model. It is the handoff surface: a video or post brief comes back with the on-disk path, size, and duration of its stored media, so the producing tool opens a local file instead of fetching a URL.

## Data it holds

The MCP owns no tables and no migrations. Every tool wraps a query, action, or service function that another part owns, so a business rule lives in that part. Tools write only through those owners: `video_analyses` (`crowsnest_save_analysis`, stamped `source = "mcp"`), `content_artifacts` (`crowsnest_save_artifact`), `transcripts` (`crowsnest_transcribe`), `remix_sessions` and the draft planned post (the remix chain). Schemas are in `src/server/db/schema.ts`.

## Tools

The endpoint is `http://localhost:3000/api/mcp`, streamable HTTP. Names, inputs, and descriptions are the registered ones in `src/server/mcp/mcp-server.ts` (`buildMcpServer`, one `registerTool` call each). Read the registration for input schemas. R is read, W is write or side effect.

| Tool | Purpose | R/W |
| --- | --- | --- |
| `crowsnest_ig_status` | Instagram sidecar reachable and logged in, plus the bootstrap command | R |
| `crowsnest_sync_selected` | Start a sync for the given channel ids, returns `jobId` | W |
| `crowsnest_sync_status` | Progress of a sync by job id | R |
| `crowsnest_sync_cancel` | Cooperative cancel of a sync | W |
| `crowsnest_channels` | Tracked channels and fleets | R |
| `crowsnest_channel_stats` | One channel's baseline, median basis, last run health | R |
| `crowsnest_feed` | Outlier feed with filters, total count | R |
| `crowsnest_video` | One video with analysis, transcript, metrics, media and thumbnail paths | R |
| `crowsnest_research_set` | Outliers with analyses plus own reach benchmark | R |
| `crowsnest_outlier_pack` | Top N shortlist with media handoff, rising mode | R |
| `crowsnest_metrics` | Own channel current and prior window, recent own posts | R |
| `crowsnest_plans` | Planned posts, optionally in a date range, each with `keyword` and `magnetUrl` | R |
| `crowsnest_set_plan_fields` | Set or clear one plan's `keyword` and `magnetUrl` | W |
| `crowsnest_attach_video` | Attach a local mp4 on the host to one plan as its publish video | W |
| `crowsnest_scripts` | Saved scripts, newest first, paged | R |
| `crowsnest_ideas` | Ideas inbox or shortlist, paged | R |
| `crowsnest_brief` | A planned post's brief with source media paths | R |
| `crowsnest_save_analysis` | Save an agent-written video analysis | W |
| `crowsnest_transcribe` | Download if needed and transcribe one video, cached | W |
| `crowsnest_save_artifact` | Persist an agent-authored artifact, update by `id` | W |
| `crowsnest_artifacts` | List or fetch saved artifacts | R |
| `crowsnest_remix_session` | Get or create the one session for a video | W |
| `crowsnest_remix_state` | Read session state | R |
| `crowsnest_remix_set_prompt` | Set topic, niche, target length | W |
| `crowsnest_remix_research` | Assemble research notes, no model call | R |
| `crowsnest_remix_hooks` | Return the Hooks-stage prompt | R |
| `crowsnest_remix_choose_hook` | Persist the chosen hook text | W |
| `crowsnest_remix_style` | Set or clear the style vault item | W |
| `crowsnest_remix_outline` | No `outline`: return the prompt. With `outline`: persist it | R/W |
| `crowsnest_remix_variants` | Return the Script-stage prompt | R |
| `crowsnest_remix_save_script` | Save the agent's script text | W |
| `crowsnest_remix_finish` | Create or reuse the draft planned post, returns `postId` | W |

Typical flows. Sync: `ig_status`, `channels`, `sync_selected`, poll `sync_status`. Analyze: `video`, `transcribe` if the transcript is null, `save_analysis`. Remix: session, set_prompt, research, hooks and choose_hook, style, outline (prompt, then again with `outline`), variants and save_script, finish, then `brief`.

## Boundaries

- Owns: the tool surface, the result contract, and the media handoff shape (`src/server/mcp/mcp-server.ts`), plus the HTTP bridge (`src/server/mcp/http.ts`).
- Called by: any MCP client over `/api/mcp`, routed by `server.ts` at the repo root. No dashboard screen calls it.
- Calls: the feed, video, post-brief, vault, ideas, own-channel, planned-posts, research, channels, and runs queries; `services/remix.ts`, `services/analyze.ts` (`saveAgentAnalysis`), `services/artifacts.ts`; `actions/sync-actions.ts`, `actions/ig-actions.ts` (`getIgStatusAction`), `actions/media-actions.ts` (`downloadVideoAction`); `transcribe` (`getOrCreateTranscript`); `media/store` (`getAsset`, `resolveAssetPath`).

## Invariants

- The server is mounted in-process so every tool call uses the app's one SQLite connection and the MCP is never a second writer. `server.ts` sends any URL starting with `/api/mcp` to `handleMcpRequest`.
- `/api/mcp` answers local clients only. `handleMcpRequest` in `src/server/mcp/http.ts` returns 403 when the `Host` header is not `localhost`, `127.0.0.1`, or `[::1]` (any port), or when an `Origin` header is present and its host is not one of those. This blocks DNS rebinding: `server.ts` listens on all interfaces, and without the check a web page could call `crowsnest_attach_video` with any local path and read the stored file back from `/api/media/<id>`. Claude Code's MCP client sends `Host: localhost:<port>` and no `Origin`, so it passes. The SDK's own `allowedHosts` option matches exact `host:port` strings, so it cannot express any port.
- The transport is stateless. `handleMcpRequest` builds a fresh `McpServer` and `StreamableHTTPServerTransport` (`sessionIdGenerator: undefined`) per request and closes both when the response closes. A throw becomes a JSON-RPC 500 envelope (`src/server/mcp/http.ts`).
- Every handler returns through `result()` or `errorResult()`. `result` serializes one value to both JSON text and `structuredContent`. `errorResult` sets `isError: true`. Handled failures (unknown id, no own channel) are error results, never thrown (`src/server/mcp/mcp-server.test.ts`).
- `mediaInfoFor` reads `path`, `byteSize`, and `durationSec` off the `media_assets` row and never touches the file. A null id or missing row returns null and an unresolvable stored path gives a null `path`.
- The remix chain is keyless. `crowsnest_remix_hooks`, `_outline`, and `_variants` return the assembled `{ system, user, context }` prompt from `services/remix.ts` builders and never call a model (`src/server/mcp/mcp-remix-keyless.test.ts`). The agent must save its outline back through `crowsnest_remix_outline` with `outline`, or the script prompt carries no beats.
- `crowsnest_remix_finish` is idempotent and is the only place the MCP creates a planned post. `crowsnest_set_plan_fields` only edits `keyword` and `magnetUrl` on an existing plan in any state, scheduled and published included, because a live reel still needs its funnel keyword. An omitted field is left alone and null clears it. The tool schema only type-checks; `setPlanFieldsAction` is the single validator, so every refusal returns `{error, code, postId}`. It refuses a `keyword` that is blank, over 64 characters after trimming, or holds a control character (Unicode `Cc`, U+2028, U+2029) (`PLAN_KEYWORD_INVALID`), and a `magnetUrl` that does not start with `http://` or `https://`, is over 2048 characters, holds a control character, or carries a user or password (`PLAN_MAGNET_URL_INVALID`). A valid link is stored as the trimmed raw string, not the parser's normalized `href`. A keyword another plan holds, compared case-insensitively for ASCII letters only (SQLite `lower()`), returns `KEYWORD_TAKEN` with nothing written. `crowsnest_plans` never writes. `crowsnest_attach_video` takes a plan id and an absolute local path (a relative path or a leading `~` is refused by the input schema, never resolved or expanded) and runs `attachPlanVideo` in `src/server/media/video-file.ts`, the same path as the upload dialog: the file must exist, be non-empty, at most 200 MB, and carry an `ftyp` box; an unknown plan returns `PLAN_NOT_FOUND` before any asset row is written; a `publishing` or `published` plan returns `PLAN_LOCKED`. It never calls `revalidatePath`, which throws outside a Next request.
- `crowsnest_sync_selected` rejects an empty `channelIds` with code `NO_CHANNELS`; there is no whole-library default. On `IG_SERVICE_DOWN` its error adds `bootstrap: "npm run ig:service"`.
- `crowsnest_ig_status` never returns an error result. Only `IG_SERVICE_DOWN` makes `reachable` false; any other failure code means the sidecar answered.
- `crowsnest_sync_status` returns null progress for an unknown job, and `crowsnest_sync_cancel` stops at the next channel boundary keeping committed work.
- `crowsnest_scripts` and `crowsnest_ideas` slice in memory because their queries take no paging arguments. `crowsnest_feed` pages in SQL.
- `crowsnest_metrics` returns `{ current, previous, posts }`; `previous` is the same-length window at offset `windowDays`. Without an own channel and a valid token it returns an error result.
- `crowsnest_channel_stats.lastRun` is the last sync run overall, because `getLastRunHealth()` takes no channel id.
- `crowsnest_save_analysis` confirms the video exists, validates against `VideoAnalysisSchema` (plus an optional `summary`), and writes nothing on failure. A second save updates the same row.
- `crowsnest_transcribe` is cache-first and needs a live sidecar for a first download and a transcript provider (whisper.cpp, or Groq with `GROQ_API_KEY`). Missing either is an error result.
- Own posts score on `reachIndex`, competitors on `outlierScore`; `research_set` and `outlier_pack` return both blocks and never merge them.
- The endpoint has no credential check. Reach is governed by the interface `server.ts` binds (`HOST`; the packaged LaunchAgent sets `127.0.0.1`).
- `src/server/mcp/mcp-roundtrip.test.ts` drives `tools/call` over an in-memory transport, and drives `handleMcpRequest` over real HTTP only for the local-client guard.

## Where to look

- `src/server/mcp/mcp-server.ts` (tool registration, `result`, `errorResult`, `mediaInfoFor`)
- `src/server/mcp/http.ts` (transport bridge)
- `server.ts` (the `/api/mcp` mount)
- `src/server/queries/research.ts` (`getResearchSet`, `getOutlierPack`)
- `src/server/services/analyze.ts` (`saveAgentAnalysis`)
- `src/server/services/artifacts.ts` (artifact persistence)
- `src/server/mcp/mcp-roundtrip.test.ts` and `mcp-remix-keyless.test.ts` (contract tests)
