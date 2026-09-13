# analyze: feature description

Analyze is what turns a raw outlier in the feed into an analyzed one. It reads a video and writes down what it is doing: its hook type, the beats of its structure, format and style tags, and a why-it-worked note. Since P0 slice 2a, that reading is done entirely outside the app: an external agent (Claude Code, Codex, or any MCP-speaking client connected to crowsnest) reads a video's context through the `crowsnest_video` MCP tool and writes its analysis back through `crowsnest_save_analysis`. Crowsnest itself needs no model key and does no reasoning; the video detail page's Hook and structure and Why it worked tabs simply render whatever analysis exists, or a plain "No analysis yet" placeholder when none does. A second feature, Generate idea, lives in the same page's action row and is unaffected: it turns one analyzed video plus the creator's persona into a single content idea in the ideas inbox, and still needs the Claude key.

## 1. Feature summary

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Analysis, authored by an external agent through MCP | An agent reads a video's context via `crowsnest_video` and writes hook, structure, format tags, style tags, and why-it-worked via `crowsnest_save_analysis`; the detail page renders whatever exists | ● | `src/server/services/analyze.ts` (`saveAgentAnalysis`), `src/server/mcp/mcp-server.ts` (`crowsnest_save_analysis`, `crowsnest_video`) | none open; the in-app Analyze/Re-analyze button and its B-17a error-code gap are retired along with it |
| 3 | Generate an idea | Turns one analyzed video plus the creator's persona into a content idea in the ideas inbox | ● | `src/server/services/ideas.ts` (`generateIdea`) | B-12 (filed in feed's backlog): the button does not gate on a key or reflect an existing idea |

## 2. Analysis, authored by an external agent through MCP

### Who uses it

The external agent connected to crowsnest over MCP (Claude Code, Codex, or any other MCP client), not the crowsnest user directly. The user's part is passive: opening a video's detail page to read whatever analysis the agent has written.

### What it does

`crowsnest_video` gives the agent a video's caption, metrics, full transcript text, and any existing analysis in one read. The agent forms its own hook type, beat-by-beat structure, format tags, style tags, why-it-worked note, and (optionally) a one-paragraph summary, then calls `crowsnest_save_analysis` with those fields. The tool validates the required fields against `VideoAnalysisSchema`, the same schema the retired in-app model call used, plus the optional `summary`, and upserts one `video_analyses` row stamped `source: "mcp"`. Calling it again for the same video replaces the row in place; there is no separate re-analyze tool, a fresh call is a fresh reading. The video detail page's Summary section renders `summary` when an agent has supplied one.

### How to access it

There is no in-app control. The video detail page's Hook and structure and Why it worked tabs render `detail.analysis` when it is present; when it is not, both tabs show a plain "No analysis yet" message. Producing an analysis is entirely the connected agent's initiative, driven by its own MCP tool calls (`crowsnest_video`, then `crowsnest_save_analysis`).

### Business rules

- `crowsnest_save_analysis` validates its payload against `VideoAnalysisSchema` before writing anything; an invalid payload or an unknown video id returns an error and leaves the database untouched.
- A cache is not involved on the write side the way it was for the retired in-app pass: every call the agent makes writes (insert or update); there is no cache-hit short-circuit, since the agent decides for itself whether to re-read and re-author.
- On the read side, the detail page always shows whatever `video_analyses` row currently exists, however it was written; it does not distinguish an agent-authored row from a legacy in-app one beyond the `source` column, which the page does not currently render.
- Crowsnest needs no `ANTHROPIC_API_KEY`, no Groq key, and no reachable transcript provider for this path to work end to end; the only external dependency is the agent itself having a model to reason with, which is entirely outside crowsnest's process.
- `crowsnest_video` returns the video's transcript text (via `getVideoDetail`, which reads the `transcripts` table) so the agent has what it needs to ground its analysis without a second tool call. If no transcript row exists yet, the field reads null; the agent can call the mcp `crowsnest_transcribe` tool to fetch and transcribe the video, after which `crowsnest_video` returns the words. The analyze component itself does not transcribe.

### Limitations

- There is no in-app way to trigger, watch, or cancel an analysis; the whole feature's liveness depends on an external agent actually calling the two MCP tools.
- There is no versioning: a second `crowsnest_save_analysis` call for the same video replaces the row in place, and the previous hook, beats, tags, and note are gone with no history kept.
- A video with no transcript row yet: the agent grounds on the caption and metrics `crowsnest_video` returns, or calls the mcp `crowsnest_transcribe` tool to create the transcript first (it downloads the video, then runs `getOrCreateTranscript`). The analyze component itself does not transcribe; the on-demand caller lives in the mcp component.

### User guide

Open a video's detail page and click Hook and structure or Why it worked. If an agent has already analyzed the video through MCP, both tabs show its hook type, beat-by-beat structure, and why-it-worked note. If not, both tabs read "No analysis yet." Ask your connected agent (for example, in a Claude Code or Codex session with the crowsnest MCP server attached) to analyze the video; once it calls `crowsnest_save_analysis`, reload the page to see the result.

## 3. Generate an idea

### Who uses it

The user, from the action row at the bottom of an analyzed video's detail page.

### What it does

Asks the language model for a one-line concept and a short angle grounded in the video's analysis and the creator's persona, then writes or refreshes the one idea for that video in the ideas inbox. This is an exit from the core loop: the idea lands in a separate inbox screen, out of scope for this repo, and the button's whole visible result on the video detail page is a toast.

### How to access it

The "Generate idea" button in the action row, alongside Remix this, the two save actions, and Copy as prompt. The button appears only on a video that already has an analysis; it does not exist at all on an unanalyzed one.

### Business rules

- At most one non-discarded idea exists per video, enforced by the `idea_source_active` partial index; a second press on the same video updates the existing idea rather than creating a duplicate.
- The update only rewrites an idea whose status is still `inbox`; an idea the user has already shortlisted or scripted is left exactly as it was, and the toast still reads "Idea updated" either way.
- What the idea is built from is decided when the request actually runs, not when the page loaded: the model reads the video's current analysis, the creator's persona, and the video's outlier score at that moment, so a fresh `crowsnest_save_analysis` call from the agent changes what the next Generate idea produces.
- `generateIdeasForNewOutliers` can also run this same generation, on demand, over a channel's analyzed outliers; the button is the on-demand version for a single video, and the two never produce two ideas for the same video.
- `generateIdea` never throws on a bad model reply; it reports back that nothing was created instead.

### Limitations

- Unlike the retired analyze gate, the button does not check whether generation is actually available before rendering; a missing key or a down proxy surfaces only after the click, as a failed toast (B-12, filed in [feed's backlog to enhance](../feed/05-backlog-to-enhance.md)).
- The button never reflects whether an idea already exists for the video; it always reads "Generate idea," regardless (B-12).
- The button honors no shortcut of its own; the detail page's arrow keys page to the previous or next video and are not tied to it.

### User guide

On an analyzed video's detail page, click Generate idea in the action row near the bottom. crowsnest reads the video's analysis and your persona and proposes one new content idea, which lands in the ideas inbox; a toast confirms whether it was added as a new idea or updated one already there for this video. You stay on the same page. Open the ideas inbox separately to see, shortlist, discard, or turn the idea into a script.

## 4. Interactions with other systems

Persistence and autosave. There is no autosave and no dirty state for either feature; both commit as one row at the end of their pass.

History and undo. Neither feature keeps history. A fresh `crowsnest_save_analysis` call overwrites the stored hook, beats, tags, and note in place with no version kept. Generate idea overwrites an untouched inbox idea's concept and angle in place; a discarded idea can later be regenerated as a fresh inbox idea.

Navigation and refresh. Neither feature refreshes the page on the user's behalf: an agent-written analysis appears once the user reloads or re-navigates to the detail page; Generate idea's own action does not refresh either, since nothing on the video detail page depends on the idea it wrote.

Background jobs and the sidecar. Analysis is never produced by a sidecar job; the in-app auto-analyze pass that once ran at the end of a sync (`auto-analyze.ts`) is retired. `generateIdeasForNewOutliers` can still run over a channel's already-analyzed outliers, but since nothing in-app writes an analysis anymore, only outliers an agent has analyzed through MCP are visible to it.

External services. No external model service is called by crowsnest itself for analysis; the reasoning happens entirely inside the connected agent's own process, outside crowsnest. The Claude API still does Generate idea's generation, direct or through a local proxy.

Status and failures. `crowsnest_save_analysis` returns `{ ok: true }` or `{ ok: false, error }` to the calling agent; there is nothing for the crowsnest user to see beyond the eventual rendered result. Generate idea's success and failure both surface as toasts on the detail page.

Configuration and settings. Analysis needs no crowsnest-side configuration at all; it is entirely a function of the connected agent's own model access. The Claude key set in Settings gates only Generate idea (and, unrelated to this component, Remix). The resolved model name recorded on an agent-authored analysis row (`video_analyses.model`) is whatever the connected agent's own MCP client sends, if anything; the column is not populated by crowsnest itself for this path. The creator's persona (audience, voice, do, and don't guidance) grounds Generate idea; the outlier score threshold that gates the automatic idea pass is read from settings.

## 5. Edge cases

- Analysis exists purely as a function of whether an agent has called `crowsnest_save_analysis` for a video; there is no crowsnest-side trigger, cache warm, or backfill.
- Layout is not produced by analysis. A video's layout comes from a separate frame pass, run from its own control in the Layout tab, with its own model and timestamp; nothing in the MCP-authored analysis path touches the layout columns.
- A beat with no per-beat transcript quote (written before that field existed, or by an agent that omitted it) renders a plain placeholder rather than an invented quote; there is no in-app re-analyze action to backfill it, only another `crowsnest_save_analysis` call.
- Style tags render muted with an "unverified" marker while format tags render plain, because a text-only reading can only guess at visual style until a frame pass confirms it. This is display, owned by the video detail page, but it reflects what a text analysis can and cannot know regardless of who authored it.
- Save to Vault and Generate idea both need an analysis to exist before they are offered; on an unanalyzed video neither is reachable.
- Generate idea's "Idea updated" toast covers two different outcomes: rewriting an untouched inbox idea with a fresh concept and angle, and leaving a shortlisted or scripted idea exactly as it was. The toast does not tell them apart.
