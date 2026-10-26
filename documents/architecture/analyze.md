# Analyze

Analyze holds a video's analysis: hook type, the beats of its structure, format and style tags, and a why-it-worked note. It turns a raw outlier in the feed into an analyzed one, and most downstream steps (save to vault, the source description a remix reads) need an analysis to exist first. Crowsnest does not write the analysis itself. An external agent (Claude Code, Codex, or any MCP client) reads a video through `crowsnest_video` and writes the result back through `crowsnest_save_analysis`.

## Data it holds

Tables are defined in `src/server/db/schema.ts`.

- `video_analyses`: one row per video, keyed on `video_id`. Analyze writes the text columns (`hook_type`, `structure_segments`, `format_tags`, `style_tags`, `why_it_worked`, `summary`, `source`, and `tag`, the Rivals card a rival's post is filed under: `take`, `learn` or `avoid`). The layout columns (`layout`, `frames_sampled`, `frame_model`, `frame_pass_at`, `frame_pass_error`) belong to the separate frame pass.
- `transcripts`: one row per video, read by `crowsnest_video`. Analyze never writes it; the MCP `crowsnest_transcribe` tool does.

## Boundaries

- Owns: `src/server/services/analyze.ts` (`saveAgentAnalysis`, `rowToAnalysis`).
- Called by: external MCP agents (`crowsnest_save_analysis`, `crowsnest_video` in `src/server/mcp/mcp-server.ts`), remix (reads the row through `rowToAnalysis`), save to vault (offered once an analysis exists).
- Calls: the database only. It never talks to Instagram and never writes `videos`.

## Invariants

- Analysis needs no model key. The app makes no model call; the agent writes the analysis.
- `crowsnest_save_analysis` is the only write path for new rows, and every row it writes is stamped `source: "mcp"`. `auto`, `manual`, and `legacy` are values from retired paths that old rows may still carry.
- A write validates against `VideoAnalysisSchema` (`src/server/schemas.ts`) plus an optional `summary` and an optional `tag` (`RivalTagSchema`). An unknown video id or an invalid payload returns `{ ok: false, error }` and writes nothing.
- A re-save updates the row in place with no history. A re-save without a `summary` leaves a stored summary alone; an explicit empty string clears it. A re-save without a `tag` keeps the stored tag.
- `summary` is validated by a local extension of the schema, not by widening `VideoAnalysisSchema`, so remix and `rowToAnalysis` stay unchanged.
- Layout is never derived from the text analysis. The five layout columns stay null until a frame pass runs.
- The web app's video detail screen is retired; its analysis tabs move into a Lead Studio board.

## Where to look

- `src/server/services/analyze.ts`
- `src/server/mcp/mcp-server.ts`
- `src/server/schemas.ts`
- `src/server/queries/video.ts`
