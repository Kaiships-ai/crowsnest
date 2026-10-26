# MCP

The MCP server runs inside crowsnest's own process at `/api/mcp` and exposes the app's data and its remix pipeline as 38 `crowsnest_*` tools. Crowsnest is the data and action brain, the calling agent (Claude, Codex, the Reel Factory) is the only reasoning brain, and no tool calls an internal model. It is the handoff surface: a video or post brief comes back with the on-disk path, size, and duration of its stored media, so the producing tool opens a local file instead of fetching a URL.

## Data it holds

The MCP owns two tables, both from migration `0036_agent_gates`. Every other write goes through the part that owns the data, so a business rule lives in that part.

- `agent_actions`: the journal. Two rows per free or gate 1 call, sharing a `call_id`: a `pending` row written before the tool runs and an `ok` or `error` row after. One `drafted` row per gate 2 call. Each row has `at`, `caller`, `tool`, `input` (JSON with every stored connector secret replaced by `[redacted]`), `result`, `gate` (`free`, `gate1`, or `gate2`), and `draft_id` for a gate 2 call. Triggers abort any `UPDATE` or `DELETE`, so the table is append-only.
- `gate_drafts`: one row per gate 2 call held for Kai: `id`, `tool`, the raw `input` (kept so an approval can run the tool later), `caller`, `status` (`pending`), `created_at`.

Tools write through their owners: `video_analyses` (`crowsnest_save_analysis`, stamped `source = "mcp"`), `content_artifacts` (`crowsnest_save_artifact`), `transcripts` (`crowsnest_transcribe`), `remix_sessions` and the draft planned post (the remix chain), `planned_posts` and `plan_versions` (the plan tools), `reel_funnel` (`crowsnest_save_funnel`). Schemas are in `src/server/db/schema.ts`.

## Tools

The endpoint is `/api/mcp`, streamable HTTP. The Lead Studio app serves it on a free `127.0.0.1` port and writes that port to `mcp.port` in its user data directory (`src/main/crowsnest/mcp-http.ts`); the headless `server.ts` serves it on `PORT`. Names, inputs, and descriptions are the registered ones in `src/server/mcp/mcp-server.ts` (`buildMcpServer`, one `registerTool` call each). Read the registration for input schemas. The level column is `TOOL_LEVELS` in `src/server/mcp/gates.ts`: 19 read, 13 free, 6 gate 1, 0 gate 2. No tool today posts to people outside the Mac. The one indirect path, an agent swapping the video of a post the publish scheduler can send on its own, is closed: `crowsnest_attach_video` takes only a draft and refuses a scheduled or failed plan with `PLAN_NOT_DRAFT` (the scheduler re-arms a failed post with a retryable error). Publish reads only a plan's video and caption, and no MCP tool sets a caption. Two free tools send data out without touching people: `crowsnest_sync_selected` reads Instagram through the sidecar, and `crowsnest_transcribe` uploads a video's audio to Groq when whisper.cpp is missing.

| Tool | Behavior today | Level |
| --- | --- | --- |
| `crowsnest_ig_status` | Instagram sidecar reachable and logged in, plus the bootstrap command | read |
| `crowsnest_sync_selected` | Start a sync for the given channel ids, returns `jobId` | free |
| `crowsnest_sync_status` | Progress of a sync by job id | read |
| `crowsnest_sync_cancel` | Cooperative cancel of a sync | free |
| `crowsnest_channels` | Tracked channels and fleets | read |
| `crowsnest_channel_stats` | One channel's baseline, median basis, last run health | read |
| `crowsnest_feed` | Outlier feed with filters, total count | read |
| `crowsnest_video` | One video with analysis, transcript, metrics, media and thumbnail paths | read |
| `crowsnest_research_set` | Outliers with analyses plus own reach benchmark | read |
| `crowsnest_outlier_pack` | Top N shortlist with media handoff, rising mode | read |
| `crowsnest_metrics` | Own channel current and prior window, recent own posts | read |
| `crowsnest_plans` | Planned posts, optionally in a date range, each with `keyword` and `magnetUrl` | read |
| `crowsnest_set_plan_fields` | Set or clear one plan's `keyword` and `magnetUrl` | gate 1 |
| `crowsnest_attach_video` | Attach a local mp4 on the host to one plan as its publish video; refuses every plan that is not a draft | gate 1 |
| `crowsnest_save_funnel` | Append a batch of funnel numbers per reel keyword | free |
| `crowsnest_funnel` | Every metric ledger number per keyword, with its target and the plan holding the keyword | read |
| `crowsnest_propose_plan` | Store a month or week reel list as the next proposed version | gate 1 |
| `crowsnest_plan_versions` | A plan's versions with status and a one-line diff naming only changed reels | read |
| `crowsnest_approve_plan` | Make a version live and sync its draft planned posts | gate 1, to move to UI (Cổng 1 board) |
| `crowsnest_undo_plan` | Restore the previously live version and its drafts | gate 1, to move to UI (Cổng 1 board) |
| `crowsnest_scripts` | Saved scripts, newest first, paged | read |
| `crowsnest_ideas` | Ideas inbox or shortlist, paged | read |
| `crowsnest_brief` | A planned post's brief with source media paths | read |
| `crowsnest_save_analysis` | Save an agent-written video analysis | free |
| `crowsnest_transcribe` | Download if needed and transcribe one video, cached; may send audio to Groq when whisper.cpp is missing | free |
| `crowsnest_save_artifact` | Persist an agent-authored artifact, update by `id` | free |
| `crowsnest_artifacts` | List or fetch saved artifacts | read |
| `crowsnest_remix_session` | Get or create the one session for a video | free |
| `crowsnest_remix_state` | Read session state | read |
| `crowsnest_remix_set_prompt` | Set topic, niche, target length | free |
| `crowsnest_remix_research` | Assemble research notes from the source analysis, transcript, and similar outliers, store them on the session, no model call | free |
| `crowsnest_remix_hooks` | Return the Hooks-stage prompt | read |
| `crowsnest_remix_choose_hook` | Persist the chosen hook text | free |
| `crowsnest_remix_style` | Set or clear the style vault item | free |
| `crowsnest_remix_outline` | No `outline`: return the prompt. With `outline`: store it on the session | free |
| `crowsnest_remix_variants` | Return the Script-stage prompt | read |
| `crowsnest_remix_save_script` | Save the agent's script text | free |
| `crowsnest_remix_finish` | Create or reuse the draft planned post, returns `postId` | gate 1 |

Typical flows. Sync: `ig_status`, `channels`, `sync_selected`, poll `sync_status`. Analyze: `video`, `transcribe` if the transcript is null, `save_analysis`. Remix: session, set_prompt, research, hooks and choose_hook, style, outline (prompt, then again with `outline`), variants and save_script, finish, then `brief`.

## Gates and the journal

Every tool has one level in `TOOL_LEVELS` (`src/server/mcp/gates.ts`):

| Level | Meaning | What the dispatcher does |
| --- | --- | --- |
| read | Writes nothing | Runs the tool. No journal row |
| free | A local write outside the plan (sync, analysis, artifact, remix session, funnel numbers) | Appends a `pending` row, runs the tool, then appends the outcome row |
| gate 1 | Changes the plan (plan fields, video, proposed and live versions, the remix draft) | Appends a `pending` row, runs the tool, then appends the outcome row |
| gate 2 | Touches people outside: publish, DM, comment reply, discount, ChatbotX flow, website deploy | Never runs the tool. Stores a `gate_drafts` row and a journal row in one transaction and returns `{ status: "pending_approval", draftId, tool, message }` |

`buildMcpServer` registers every tool through `gatedRegistrar`, never `server.registerTool` directly. Its name parameter is typed as a key of `TOOL_LEVELS`, so a tool with no level does not compile, and at runtime a name with no valid level throws `MCP tool <name> has no gate level` before the server starts answering. `src/server/mcp/gates.test.ts` checks that the registered tools are exactly the 38 keys.

The journal `caller` is the MCP client name from `initialize` when the server saw one (an in-memory client), else the HTTP `User-Agent`, else `unknown`. The HTTP transport is stateless, so an app call gets the `User-Agent`. Input is scrubbed with `scrubSecrets` (`src/server/connectors/scrub-secrets.ts`), the scrubber the engine bridge uses: every connector secret of 8 or more characters becomes `[redacted]`, in its raw and its JSON-escaped form. While the Keychain is locked (`SecretLockedError`, outside Lead Studio) the input is stored as `[unscrubbed: secret store locked]`, never raw.

The journal fails closed. When the `pending` row cannot be written, the tool does not run and the call returns `JOURNAL_UNAVAILABLE`. When the outcome row cannot be written, the call keeps its result, the failure is logged as `mcp.journal_outcome_failed`, and the journal shows only `pending` for that `call_id`; it never records a false `error`. A tool that throws gets an `error` row and the throw continues to the SDK. A call whose arguments fail the tool's input schema is refused by the SDK before the dispatcher runs, so it is not journaled; nothing ran. The journal reaches the renderer through the bridge call `listAgentActions(limit?)`, newest first, 100 by default and at most 500.

There is no MCP path to approve a gate 2 draft. Approval is a UI action that the Cổng 2 board adds. `crowsnest_approve_plan` and `crowsnest_undo_plan` stay on MCP as gate 1 until the Cổng 1 board exists.

## Boundaries

- Owns: the tool surface, the result contract, and the media handoff shape (`src/server/mcp/mcp-server.ts`), the gate levels and dispatcher (`src/server/mcp/gates.ts`), the journal and gate drafts (`src/server/services/agent-journal.ts`), plus the HTTP bridge (`src/server/mcp/http.ts`).
- Called by: any MCP client over `/api/mcp`, routed by `src/main/crowsnest/mcp-http.ts` in the app or by `server.ts` at the repo root. The renderer reads the journal through `listAgentActions` in `src/server/bridge/engine-calls.ts`.
- Calls: the feed, video, post-brief, vault, ideas, own-channel, planned-posts, research, channels, and runs queries; `services/remix.ts`, `services/analyze.ts` (`saveAgentAnalysis`), `services/artifacts.ts`; `actions/sync-actions.ts`, `actions/ig-actions.ts` (`getIgStatusAction`), `actions/media-actions.ts` (`downloadVideoAction`); `transcribe` (`getOrCreateTranscript`); `media/store` (`getAsset`, `resolveAssetPath`).

## Invariants

- The server is mounted in-process so every tool call uses the app's one SQLite connection and the MCP is never a second writer. `server.ts` sends any URL starting with `/api/mcp` to `handleMcpRequest`.
- `/api/mcp` has a DNS-rebinding and cross-origin guard, not authentication. `handleMcpRequest` in `src/server/mcp/http.ts` returns 403 when the `Host` header is not `localhost`, `127.0.0.1`, or `[::1]` (any port), or when an `Origin` header is present and its host is not one of those. This blocks DNS rebinding: `server.ts` listens on all interfaces unless `HOST` is set, and without the check a web page could call `crowsnest_attach_video` with any local path and write that file into the media store. Claude Code's MCP client sends `Host: localhost:<port>` and no `Origin`, so it passes. Any local or LAN process that sends `Host: localhost` and no `Origin` passes too, and no credential is checked. The SDK's own `allowedHosts` option matches exact `host:port` strings, so it cannot express any port.
- The transport is stateless. `handleMcpRequest` builds a fresh `McpServer` and `StreamableHTTPServerTransport` (`sessionIdGenerator: undefined`) per request and closes both when the response closes. A throw becomes a JSON-RPC 500 envelope (`src/server/mcp/http.ts`).
- Every handler returns through `result()` or `errorResult()`. `result` serializes one value to both JSON text and `structuredContent`. `errorResult` sets `isError: true`. Handled failures (unknown id, no own channel) are error results, never thrown (`src/server/mcp/mcp-server.test.ts`).
- `mediaInfoFor` reads `path`, `byteSize`, and `durationSec` off the `media_assets` row and never touches the file. A null id or missing row returns null and an unresolvable stored path gives a null `path`.
- The remix chain is keyless. `crowsnest_remix_hooks`, `_outline`, and `_variants` return the assembled `{ system, user, context }` prompt from `services/remix.ts` builders and never call a model (`src/server/mcp/mcp-remix-keyless.test.ts`). The agent must save its outline back through `crowsnest_remix_outline` with `outline`, or the script prompt carries no beats.
- `crowsnest_remix_finish` is idempotent and is the only place the MCP creates a planned post. `crowsnest_set_plan_fields` only edits `keyword` and `magnetUrl` on an existing plan in any state, scheduled and published included, because a live reel still needs its funnel keyword. An omitted field is left alone and null clears it. The tool schema only type-checks; `setPlanFieldsAction` is the single validator, so every refusal returns `{error, code, postId}`. It refuses a `keyword` that is blank, over 64 characters after trimming, or holds a control character (Unicode `Cc`, U+2028, U+2029) (`PLAN_KEYWORD_INVALID`), and a `magnetUrl` that does not start with `http://` or `https://`, is over 2048 characters, holds a control character, or carries a user or password (`PLAN_MAGNET_URL_INVALID`). A valid link is stored as the trimmed raw string, not the parser's normalized `href`. A keyword another plan holds, compared case-insensitively for ASCII letters only (SQLite `lower()`), returns `KEYWORD_TAKEN` with nothing written. `crowsnest_plans` never writes. `crowsnest_attach_video` takes a plan id and an absolute local path (a relative path or a leading `~` is refused by the input schema, never resolved or expanded) and runs `attachPlanVideo` in `src/server/media/video-file.ts`, the same path as the upload action: the file must exist, be non-empty, at most 200 MB, and carry an `ftyp` box; an unknown plan returns `PLAN_NOT_FOUND` before any asset row is written; a `publishing` or `published` plan returns `PLAN_LOCKED`; any other state that is not `draft` returns `PLAN_NOT_DRAFT`, because the publish scheduler sends a scheduled post and re-arms a failed one without Kai seeing the new video. The upload action in the UI still attaches to a scheduled or failed plan.
- `crowsnest_save_funnel` takes `agent` and 1 to 1000 rows of `{ keyword, source, metric, value, capturedAt }`; `source` is one of `chatbotx`, `umami`, `polar`, `skool`, and `metric` must be one the metric ledger names for that source (see `data.md`). The whole batch is validated in the handler before one transaction inserts it, so one bad row writes nothing and returns code `INVALID_ROWS` with the row and field. The tool's input schema is deliberately loose so a bad row reaches that check instead of the SDK's uncoded validation error. `value` must be zero or more, `metric` is lowercased before the check, and `capturedAt` is required, carries an offset, and may not be more than five minutes in the future. A repeated identical batch appends rows but leaves the latest values unchanged. `crowsnest_funnel` never writes, takes an optional `keyword` (case-insensitive), and returns one entry per keyword with every ledger metric (id, label, window, target, and a `value`, `missing` or `not-connected` status) and `plan: null` for a keyword no plan holds. Logic lives in `src/server/services/funnel.ts`.
- `crowsnest_propose_plan` takes `period` (`month` or `week`), `periodKey` (`YYYY-MM` or `YYYY-Www`), `agent`, and 1 to 62 reels of `{ key, title, date?, time?, keyword?, note? }`, validated in the service by `ReelListSchema` (unique keys, unique keywords); the MCP input schema checks types only, so an empty list, a bad period, or a bad period key returns `INVALID_PLAN` like any other refusal, and stores nothing. `crowsnest_plan_versions` returns the newest `limit` versions (default 5, clamped to 1 to 50), plus the `version` asked for when it is older than that window (an unknown `version` returns `INVALID_PLAN`), each with status, reel count, and a diff against the version before (`vs v1: added X. removed Y. changed Z (title)`) that names at most 3 reels per list then `+N more`, plus the full reels only for the `version` asked for. The MCP schema marks every field optional, so a missing `agent`, `reels`, reel `key`, or reel `title` also returns `INVALID_PLAN`. `crowsnest_approve_plan` and `crowsnest_undo_plan` change only pristine drafts: state `draft`, no script, video, caption, source video, or magnet URL, no target length, video kind, or remix session, and title, date, time, keyword, and note equal to `planSynced`. Every other plan post is left alone and listed under `kept` with its reel key, a reason (`not_draft`, `has_script`, `has_video`, `has_caption`, `has_source_video`, `has_magnet`, `has_settings`, `edited`), and `notApplied`, the reel fields not applied (`removed` when the reel left the list, every field when `planSynced` is null). A reel keyword held by another post, a kept one included, returns `KEYWORD_TAKEN` naming the holder's post id and reel key, with nothing changed; undo with no earlier live version returns `NOTHING_TO_UNDO`. Approve and undo are guarded over MCP by the server instruction only (approve only when Kai says so) and journaled as gate 1, until the Cổng 1 board moves them to the UI. Logic lives in `src/server/services/plan-versions.ts`.
- `crowsnest_sync_selected` rejects an empty `channelIds` with code `NO_CHANNELS`; there is no whole-library default. On `IG_SERVICE_DOWN` its error adds `bootstrap: "pnpm run ig:service"`.
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
- `src/server/mcp/gates.ts` (`TOOL_LEVELS`, `gatedRegistrar`) and `src/server/services/agent-journal.ts` (journal and gate drafts)
- `src/server/mcp/http.ts` (transport bridge)
- `server.ts` (the `/api/mcp` mount)
- `src/server/queries/research.ts` (`getResearchSet`, `getOutlierPack`)
- `src/server/services/analyze.ts` (`saveAgentAnalysis`)
- `src/server/services/artifacts.ts` (artifact persistence)
- `src/server/mcp/mcp-roundtrip.test.ts` and `mcp-remix-keyless.test.ts` (contract tests)
