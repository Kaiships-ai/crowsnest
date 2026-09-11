# analyze: concept brief

`documents/architect/core-components/analyze/`

Status: shipped and in daily use. Analysis is authored only by an external agent through MCP; crowsnest itself needs no model key for a video to have one. Generate idea, unaffected, still needs a Claude key, and a Kit install completing a real Generate idea call with a live key has not been proven end to end.

## 1. What it is

Analyze is the component that holds a video's analysis: its hook type, the beats of its structure, format and style tags, and a "why it worked" note. It turns a raw outlier in the feed into an analyzed one, and it is the gate almost everything downstream sits behind, save to vault, generate an idea, and the source description a remix reads all need an analysis to exist first. Since P0 slice 2a, crowsnest does not produce that analysis itself: an external agent (Claude Code, Codex, or any MCP client connected to crowsnest) reads a video's context through `crowsnest_video` and writes the analysis back through `crowsnest_save_analysis`. The video detail page's Hook and structure and Why it worked tabs simply render whatever exists, or "No analysis yet" when nothing does; there is no button, no gate, and no key check on this surface. A second feature, Generate idea, lives in the same page's action row: it turns one analyzed video plus the creator's persona into a single content idea and drops it into the ideas inbox (`generateIdeaAction`). Both interactions are documented in full in [feature description](03-feature-description.md).

Analysis needs nothing from crowsnest to be written, no key, no reachable transcript provider, no proxy. `crowsnest_video` gives the agent a video's caption, metrics, full transcript text, and any existing analysis in one call; whatever reasoning happens over that context happens entirely inside the agent's own process. `crowsnest_save_analysis` validates the result against `VideoAnalysisSchema` and upserts one `video_analyses` row.

## 2. Why it exists

The whole product is a loop from someone else's outlier to the user's own script, and that loop is only possible once something has an opinion about why the outlier worked. Analyze holds that opinion in a fixed, structured shape (validated against `VideoAnalysisSchema`) so that every downstream step, the idea generator, the remix research stage, the save to vault templates, reads the same hook, structure, tags, and why fields regardless of who authored them. Moving authorship to an external agent (P0 slice 2a) removes crowsnest's own dependency on a model key entirely for this step; a fresh install has video analyses the moment a connected agent starts using `crowsnest_save_analysis`, with nothing to configure first.

## 3. Key concepts

| Concept | Description |
| --- | --- |
| Analysis | The single `video_analyses` row per video: hook type, beat-by-beat structure, format and style tags, and a why-it-worked note, validated 1:1 against `VideoAnalysisSchema`. It is the gate almost everything downstream sits behind. |
| Text pass versus layout | Analyze owns only the text columns (hook, structure, format, style, why). The five layout columns on the same row come from a separate frame pass with its own model and its own timestamp, untouched by an agent-authored analysis. |
| Agent-authored, through MCP | `crowsnest_save_analysis` is the only write path for a new analysis; it validates the payload and upserts the row stamped `source: "mcp"`, through `saveAgentAnalysis`, with no LLM call of crowsnest's own. |
| Read for grounding | `crowsnest_video` returns a video's caption, metrics, full transcript text, and any existing analysis, so an agent can author a grounded analysis from one call. |
| Idea | The one row per video Generate idea writes into the `idea` table: a one-line concept and a short angle asked from the video's analysis and the creator's persona, capped at one non-discarded idea per video by the `idea_source_active` partial index. |
| The ideas pass | `generateIdeasForNewOutliers` turns a channel's already-analyzed outliers into ideas, capped at 20, gated on `OUTLIER_IDEA_THRESHOLD` (3), and never throws, so one bad candidate never stops the run. Since nothing in-app writes an analysis anymore, only outliers an agent has analyzed through MCP are visible to it. |

## 4. How it fits in the system

Analyze sits between the videos a sync already wrote and everything in the app that reasons about why a video worked. It never talks to Instagram and never writes the `videos` table itself. On the video detail page, the Hook and structure and Why it worked tabs render whatever `video_analyses` row exists, or a plain "No analysis yet" placeholder; producing that row is entirely the connected agent's initiative, driven by its own `crowsnest_video`/`crowsnest_save_analysis` calls. The same page's action row carries Generate idea, gated on the same analysis existing. Downstream, remix reads a video's analysis to describe the source post, and save to vault is offered only once an analysis exists. `generateIdeasForNewOutliers` can also run on demand over a channel's already-analyzed outliers, but there is no automatic in-app analyze pass feeding it anymore.

## 5. Dependency map

### Upstream (what analyze depends on)

| Dependency | Why |
| --- | --- |
| SQLite database via drizzle (`src/server/db`) | The tables analyze reads and writes: `videos`, `transcripts`, `video_analyses`, `idea`. |
| The MCP server (`src/server/mcp/mcp-server.ts`) | `crowsnest_save_analysis` and `crowsnest_video` are the whole surface an external agent uses to author and ground an analysis. |
| [The llm layer](../llm/01-concept-brief.md) (`src/server/llm/client.ts`) | `getLlm`, `resolveModel`, and `hasLlmKey` are how Generate idea alone reaches Claude, direct or through a local proxy; `NoApiKeyError` is what a missing key throws before any request is made. Not imported by `analyze.ts` or the analyze actions. |
| The transcribe layer (`src/server/transcribe`) | `getOrCreateTranscript` is the cache-first whisper.cpp then Groq chain. The mcp component's `crowsnest_transcribe` tool wires it (downloading the video first), so a transcript can be produced on demand; nothing in the analyze component itself calls it, and a video's transcript reaches `crowsnest_video` from that MCP call or from a `transcripts` row written earlier. |
| The persona (`src/server/services/persona.ts`) | `getPersona` supplies the single audience, voice, do, and don't row Generate idea's prompt is built from. |
| The app secret store | `ANTHROPIC_API_KEY`, database first, environment fallback, gates only Generate idea now, not analysis itself. |
| ig-sync | The writer of the `videos` row analysis is written against. |

### Downstream (what depends on analyze)

| Consumer | What it reads |
| --- | --- |
| Video detail page (Hook and structure tab, Why it worked tab) | The stored analysis, or the "No analysis yet" placeholder; the whole reason this component exists on that page. |
| Save to vault | Gated on `detail.analysis` existing; offered only once a video has been analyzed. |
| remix | Reads a video's `video_analyses` row (through the same `rowToAnalysis` mapping analyze itself uses) to describe the source video's hook and structure. |
| Ideas inbox | The `idea` rows Generate idea and `generateIdeasForNewOutliers` write; the inbox screen itself is a separate surface out of scope for this repo. |
| External agents (Claude Code, Codex, other MCP clients) | `crowsnest_video` for context, `crowsnest_save_analysis` to write; this is now the primary consumer-and-producer relationship for analysis itself. |

### External

| Dependency | Role |
| --- | --- |
| Anthropic API (Claude) | Reached directly, or through a local OpenAI-compatible proxy when `LLM_BASE_URL` is set, for Generate idea's call. Not reached by analysis itself, which runs inside the connected agent's own process, outside crowsnest. |
| Groq (`whisper-large-v3-turbo`) | An external transcription provider, kept as infrastructure; used only when `GROQ_API_KEY` is set and whisper.cpp is unavailable or fails, on whatever path calls `getOrCreateTranscript`. |
| whisper.cpp | A local binary plus a downloaded GGML model; the keyless, fully local transcription path, kept as infrastructure. |

## 6. Boundaries

Analyze owns the `video_analyses` row's text columns (hook, structure, format tags, style tags, why) and the write path to them, `saveAgentAnalysis`/`crowsnest_save_analysis`. It does not own the reasoning that produces those values; since P0 slice 2a that reasoning happens entirely inside an external agent's own process, outside crowsnest, and crowsnest holds no model client for it. It owns Generate idea's on-demand button and the `idea` row it writes. It does not own the layout of a video: that is a separate frame pass, run from the Layout tab with its own model and timestamp, untouched by an agent-authored analysis. It does not own transcription itself, a separate keyless-capable path now driven on demand by the mcp component's `crowsnest_transcribe` tool rather than by anything in this flow, nor the model client, the llm layer, which only Generate idea still uses. It does not own the ideas inbox: Generate idea is an exit from the core loop, and the inbox screen where the idea lands is out of scope for this repo. Whether a Kit install can complete a real Generate idea call end to end, with a live Claude key and no local proxy in front of it, is called out as unverified in [packaging and release](../../shared/packaging-and-release.md); analysis itself needs no such proof.
