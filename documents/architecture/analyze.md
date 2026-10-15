# Analyze

Analyze holds a video's analysis: hook type, the beats of its structure, format and style tags, and a why-it-worked note. It turns a raw outlier in the feed into an analyzed one, and most downstream steps (save to vault, Generate idea, the source description a remix reads) need an analysis to exist first. Crowsnest does not write the analysis itself. An external agent (Claude Code, Codex, or any MCP client) reads a video through `crowsnest_video` and writes the result back through `crowsnest_save_analysis`. The same part also owns Generate idea, which turns one analyzed video plus the creator's persona into one idea in the ideas inbox.

## Data it holds

Tables are defined in `src/server/db/schema.ts`.

- `video_analyses`: one row per video, keyed on `video_id`. Analyze writes the text columns (`hook_type`, `structure_segments`, `format_tags`, `style_tags`, `why_it_worked`, `summary`, `source`). The layout columns (`layout`, `frames_sampled`, `frame_model`, `frame_pass_at`, `frame_pass_error`) belong to the separate frame pass.
- `idea`: one row per generated idea. The partial unique index `idea_source_active` allows at most one non-discarded idea per `source_video_id`. `idea_status` is a plain index backing the inbox filters.
- `transcripts`: one row per video, read by `crowsnest_video`. Analyze never writes it; the MCP `crowsnest_transcribe` tool does.

## Boundaries

- Owns: `src/server/services/analyze.ts` (`saveAgentAnalysis`, `rowToAnalysis`), `generateIdea` and `generateIdeasForNewOutliers` in `src/server/services/ideas.ts`, `src/server/actions/idea-actions.ts` (`generateIdeaAction`), the Hook and structure and Why it worked tabs and the Generate idea button in `src/components/video/video-detail.tsx`.
- Called by: external MCP agents (`crowsnest_save_analysis`, `crowsnest_video` in `src/server/mcp/mcp-server.ts`), the video detail page, remix (reads the row through `rowToAnalysis`), save to vault (offered once an analysis exists).
- Calls: the database, the LLM layer (`src/server/llm/client.ts`) for Generate idea only, the persona service for Generate idea's prompt. It never talks to Instagram and never writes `videos`.

## Invariants

- Analysis needs no model key. `saveAgentAnalysis` never resolves an LLM client; the only key-gated path in this part is Generate idea (`src/server/services/analyze.ts`).
- `crowsnest_save_analysis` is the only write path for new rows, and every row it writes is stamped `source: "mcp"`. `auto`, `manual`, and `legacy` are values from retired paths that old rows may still carry.
- A write validates against `VideoAnalysisSchema` (`src/server/llm/schemas.ts`) plus an optional `summary`. An unknown video id or an invalid payload returns `{ ok: false, error }` and writes nothing.
- A re-save updates the row in place with no history. A re-save without a `summary` leaves a stored summary alone; an explicit empty string clears it.
- `summary` is validated by a local extension of the schema, not by widening `VideoAnalysisSchema`, so remix and `rowToAnalysis` stay unchanged.
- Layout is never derived from the text analysis. The five layout columns stay null until a frame pass runs.
- At most one non-discarded idea per video. `generateIdea` does a select-then-update upsert because a partial index cannot be an `onConflictDoUpdate` target, and it rewrites only an idea still in `inbox`. It never throws; a bad model reply returns `{ id: "", created: false }` (`src/server/services/ideas.ts`).
- Every `generateIdeaAction` failure carries a `code` (`IDEA_GENERATE_FAILED` or `IDEA_GENERATE_UNKNOWN`).
- The Generate idea button renders only when an analysis exists. It is disabled with a tooltip when no Claude key is set, and shows the existing idea's status instead of re-generating when one exists (`src/components/video/video-detail.tsx`).
- `generateIdeasForNewOutliers` (cap 20, threshold `OUTLIER_IDEA_THRESHOLD` = 3 in `src/server/services/outlier-calc.ts`) has no caller in `src/` other than tests. Sync no longer runs an auto-analyze or idea pass, so nothing triggers it automatically.
- A beat with no per-beat transcript renders a plain placeholder, never an invented quote. Style tags render muted with an "unverified" marker, because a text-only reading can only guess visual style.

## Where to look

- `src/server/services/analyze.ts`
- `src/server/mcp/mcp-server.ts`
- `src/server/llm/schemas.ts`
- `src/server/services/ideas.ts`
- `src/server/actions/idea-actions.ts`
- `src/components/video/video-detail.tsx`
- `src/server/queries/video.ts`
