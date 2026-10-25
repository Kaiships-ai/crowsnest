# Analyze cases

## Built features

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Analysis, authored by an external agent through MCP | An agent reads a video's context via `crowsnest_video` and writes hook, structure, format tags, style tags, and why-it-worked via `crowsnest_save_analysis` | ● | `src/server/services/analyze.ts` (`saveAgentAnalysis`), `src/server/mcp/mcp-server.ts` (`crowsnest_save_analysis`, `crowsnest_video`) | none open; the in-app Analyze/Re-analyze button and its B-17a error-code gap are retired along with it |

## Behavior notes

- Analysis is authored by a connected agent: it calls `crowsnest_video` for caption, metrics, transcript text and any existing analysis, then `crowsnest_save_analysis`.
- Analysis has no autosave or history.

## analyze: test cases

Result markers: 🟢 pass, 🔴 bug, 🟡 blocked (missing dependency named in the cell). Rows still reading "not run" were not driven in QA round 1.

P0 slice 2a retired the in-app Analyze/Re-analyze button and the internal-model path behind it (`getOrCreateAnalysis`, `analyzeVideoAction`, `reanalyzeVideoAction`, `auto-analyze.ts`). Analysis is now authored only by an external agent through the `crowsnest_save_analysis` and `crowsnest_video` MCP tools; every ANALYZE-* row below that exercised the retired button, its gate faces, or its key-dependent states is retired along with it. Rows ANALYZE-14 and ANALYZE-15, about how an existing analysis renders, are unaffected. The in-app Generate idea button is removed too, and its IDEA-* rows with it.

How to run these: the route and action rows run offline with `pnpm test --project crowsnest` (vitest) against a temporary SQLite database, no external service needed. The web app's browser journeys and its :3001 dev server are retired with the web app; a UI case returns when its Lead Studio board is built.

## 1. behavior

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ANALYZE-18 | P1 | none (keyless) | `crowsnest_video` returns the video's transcript text alongside its analysis, so an agent can ground a fresh reading without a second tool call ([business rules](#built-features)). | A video with a stored transcript row. | 1. Call `crowsnest_video(videoId)`. | The result's `transcript.text` carries the stored transcript; `analysis` carries the current row or null. | 🟢 covered by vitest (`mcp-server.test.ts`'s keyless round-trip test) |
| ANALYZE-19 | P1 | none | A second `crowsnest_save_analysis` call for the same video replaces the row in place; there is no separate re-analyze tool ([what it does](#built-features)). | A video already analyzed. | 1. Call `crowsnest_save_analysis` again with different fields. | The `video_analyses` row's fields are replaced; exactly one row still exists for the video. | 🟢 covered by vitest (`analyze.test.ts`, "re-save updates the existing row in place") |
| ANALYZE-20 | P2 | invalid payload | `crowsnest_save_analysis` rejects an invalid payload without writing anything ([business rules](#built-features)). | A video with no analysis yet. | 1. Call `crowsnest_save_analysis` with a payload missing required fields. | The call returns an error; no `video_analyses` row is written. | 🟢 covered by vitest (`mcp-server.test.ts`, "rejects invalid fields without writing a row") |
| ANALYZE-10 | P1 | transcript + key | (B-10, filed in feed's backlog) The `video_analyses.summary` field is still never written by any current path ([architecture page, key decisions](../../../documents/architecture/analyze.md)). | An analyzable video. | 1. Save an analysis through `crowsnest_save_analysis`.<br>2. Read the analysis row. | Record what happens: the summary stays empty. (suspected bug) | 🔴 confirmed at data level: 0 of 25 video_analyses have a non-empty summary (B-10, summary never written by any path) |

Retired with the web app (the video detail screen no longer exists): ANALYZE-14, ANALYZE-15, ANALYZE-16, ANALYZE-17. The MCP write-then-read claim ANALYZE-17 carried is covered by ACTION-07.

Retired (P0 slice 2a, the in-app Analyze/Re-analyze button no longer exists): ANALYZE-01 through ANALYZE-09, and ANALYZE-11 through ANALYZE-13, which exercised the gate's four faces, the Analyze/Transcribe & Analyze/Re-analyze buttons, their pending labels, and B-17a's missing error code. B-17a itself is fixed by retirement (no in-app analyze action remains to carry the gap).

Not checkable by hand:

- Where a summary would come from, which could not be determined from the code.

## 2. route and action

| ID | P | Layer | Claim | Setup | Call | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ACTION-01 | P1 | server action (`src/server/services/analyze.ts :: saveAgentAnalysis`) | Validates and upserts an agent-authored analysis stamped `source: "mcp"`, never calling a model. | A temp SQLite database with a video row, no `video_analyses` row yet. | `saveAgentAnalysis(videoId, fields)`. | Returns `{ ok: true }`; the `video_analyses` row is inserted with `source: "mcp"` and the given fields. | 🟢 covered by vitest (green) |
| ACTION-02 | P1 | server action (`src/server/services/analyze.ts :: saveAgentAnalysis`) | A second call for the same video updates the existing row in place, keeping `source: "mcp"`. | An existing `video_analyses` row for the video. | `saveAgentAnalysis(videoId, newFields)`. | The row's fields are replaced; exactly one row exists afterward; `source` is still `"mcp"`. | 🟢 covered by vitest (green) |
| ACTION-03 | P1 | server action (`src/server/services/analyze.ts :: saveAgentAnalysis`) | Rejects invalid fields without writing a row. | A video row, no `video_analyses` row yet. | `saveAgentAnalysis(videoId, { hookType: "x" })` (missing required fields). | Returns `{ ok: false, error }`; no `video_analyses` row exists afterward. | 🟢 covered by vitest (green) |
| ACTION-04 | P1 | server action (`src/server/services/analyze.ts :: saveAgentAnalysis`) | Rejects an unknown video id. | No video row for the given id. | `saveAgentAnalysis("no-such-video", fields)`. | Returns `{ ok: false, error: "video not found" }`. | 🟢 covered by vitest (green) |
| ACTION-05 | P1 | server action (`src/server/services/analyze.ts :: saveAgentAnalysis`, `rowToAnalysis`) | Remix reads the agent-saved analysis unchanged, through the same `rowToAnalysis` mapping. | A video analyzed via `saveAgentAnalysis`. | `saveAgentAnalysis(videoId, fields)`, then read the row and map it with `rowToAnalysis`. | The mapped shape's `hookType`, `formatTags`, and `whyItWorked` match what was saved exactly. | 🟢 covered by vitest (green) |
| ACTION-06 | P1 | server action (`src/server/services/analyze.ts :: saveAgentAnalysis`, `rowToAnalysis`) | The whole write-then-read path works with no model key configured anywhere in the process. | no model key configured, a video with a stored transcript. | `saveAgentAnalysis(videoId, fields)`, then read `video_analyses` and `transcripts` back. | The analysis round-trips correctly and the transcript row is present, with no key configured and no LLM client invoked at any point. | 🟢 covered by vitest (green), `analyze.test.ts`'s "keyless path" test |
| ACTION-07 | P1 | MCP tool (`crowsnest_save_analysis`, `crowsnest_video`) | A client can save an analysis via `crowsnest_save_analysis` and read it back via `crowsnest_video`, transcript included, with no model key configured. | no model key configured, a video with a stored transcript, an in-memory MCP server. | `crowsnest_save_analysis(videoId, fields)`, then `crowsnest_video(videoId)`. | The save call does not error; the read call's `analysis` matches the saved fields and `transcript.text` is non-empty. | 🟢 covered by vitest (green), `mcp-server.test.ts`'s keyless round-trip test |
| ACTION-08 | P1 | MCP tool (`crowsnest_save_analysis`) | Stores an agent analysis with `source: "mcp"` over the real MCP tool registry. | A video row, an in-memory MCP server. | `crowsnest_save_analysis(videoId, fields)`. | The call does not error; the `video_analyses` row has `source: "mcp"` and the given `hookType`. | 🟢 covered by vitest (green) |
| ACTION-09 | P2 | MCP tool (`crowsnest_save_analysis`) | Rejects invalid `structureSegments` without writing a row, over the real MCP tool registry. | A video row. | `crowsnest_save_analysis(videoId, fields)` with a malformed `structureSegments` entry. | The call errors (`isError: true`); no `video_analyses` row exists afterward. | 🟢 covered by vitest (green) |
| ACTION-10 | P2 | schema (`src/server/schemas.ts :: VideoAnalysisSchema`) | A structure segment carrying a verbatim transcript validates; a structure segment with no transcript is rejected, so the write path can never store a beat with no words. | None (pure schema validation). | Parse a segment with `transcript` set, then one without. | The first parses; the second is rejected by `VideoAnalysisSchema`. | 🟢 covered by vitest (green) |

Retired (P0 slice 2a, `getOrCreateAnalysis` and `auto-analyze.ts` are deleted): the prior ACTION-01 through ACTION-08 (`getOrCreateAnalysis` cache/transcribe/force behavior, superseded by the ACTION-01 through ACTION-09 rows above) and the prior ACTION-15 through ACTION-21 (`autoAnalyzeNewOutliers`'s selection, cap, download, error-handling, and heartbeat behavior; there is no in-app auto-analyze pass left to test).

Not checkable by hand:

- None. Analysis never touches a model or a key inside the app.

## 3. browse-e2e

No journeys. Analysis (`#2`) is authored entirely outside the app by an external agent over MCP, and the web app is deleted, so there is no browser journey left. Coverage is at the MCP layer (ACTION-06, ACTION-07 in section 2).

Retired with Generate idea: E2E-02 (generate an idea), E2E-07 (fails cleanly when the model is unreachable), E2E-08 (generating twice updates).

Retired (P0 slice 2a, the in-app Analyze/Re-analyze button no longer exists): E2E-01 (analyze an unanalyzed video), E2E-03 (re-analyze), E2E-04 (empty state via the gate's recovery button), E2E-05 (auth: gate refuses with no key), E2E-06 (failure: gate dead-ends with no transcript provider). The two keyless-analysis claims these once carried (no-key still works via MCP, a missing transcript is visible to the agent) are now covered at the MCP layer by ACTION-06 and ACTION-07 in section 2, not by a browser journey.

Not checkable by hand:

- None.

## 4. security-lite

| ID | P | Threat | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-01 | P1 | Secret handling | Analysis needs no secret at all: `crowsnest_save_analysis` and `crowsnest_video` work with no model key configured, so there is no key to leak on this path. | No model key configured. | 1. Confirm `analyze.test.ts`/`mcp-server.test.ts`'s keyless tests pass. | Green in vitest with no key configured. | 🟢 covered by vitest (green) |
| SEC-02 | P2 | No buyer data leaving the box | Nothing crowsnest itself does for analysis calls any external service; the transcript text `crowsnest_video` returns, and the reasoning over it, both happen inside the connected agent's own process. | An analyzed video, network traffic observable. | 1. Save an analysis via `crowsnest_save_analysis` and observe crowsnest's own outbound network traffic. | No outbound network call from crowsnest itself (the agent's own calls happen outside crowsnest's process and are out of scope here). | 🟢 covered by inspection: `saveAgentAnalysis` and the MCP tools make no HTTP calls |

Security-lite has no rows for a license gate or a sidecar shared token: analyze has no license check of its own, and it never talks to the ig-sync sidecar directly.
