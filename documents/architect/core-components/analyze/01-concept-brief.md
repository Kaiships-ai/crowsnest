# analyze: concept brief

`documents/architect/core-components/analyze/`

Status: shipped and in daily use, a Kit install completing a real analysis with a live Claude key has not been proven end to end.

## 1. What it is

Analyze is the component that reads one video and writes down what it is doing: its hook type, the beats of its structure, format and style tags, and a "why it worked" note. It turns a raw outlier in the feed into an analyzed one, and it is the gate almost everything downstream sits behind, save to vault, generate an idea, and the source description a remix reads all need an analysis to exist first. It lives on the video detail page inside the Hook and structure and Why it worked tabs, driven by one button (`analyzeVideoAction`, `reanalyzeVideoAction`) and the generation it triggers, there is no separate page and no dialog. A second feature, Generate idea, lives in the same page's action row: it turns one analyzed video plus the creator's persona into a single content idea and drops it into the ideas inbox (`generateIdeaAction`). Both interactions are documented in full in [feature description](03-feature-description.md).

Analysis needs two things to run: a transcript of the video and the Claude API key. A transcript it will make on demand through a transcript provider (whisper.cpp locally, or Groq with a key) if none is stored, provided the video's own video asset has already been downloaded, the key it cannot make, and without it the generation fails. A cache hit returns the stored analysis without touching the transcript chain or the model at all.

## 2. Why it exists

The whole product is a loop from someone else's outlier to the user's own script, and that loop is only possible once the app has an opinion about why the outlier worked. Analyze produces that opinion in a fixed, structured shape (validated against `VideoAnalysisSchema`) so that every downstream step, the idea generator, the remix research stage, the save to vault templates, reads the same hook, structure, tags, and why fields rather than re-reading the raw video each time. Making it on-demand and cache-first, rather than analyzing every video at sync time, keeps the model spend on the handful of videos the user actually opens while still letting the sidecar sync run an automatic pass over the channel's top-scoring outliers ahead of the user.

## 3. Key concepts

| Concept | Description |
| --- | --- |
| Analysis | The single `video_analyses` row per video: hook type, beat-by-beat structure, format and style tags, and a why-it-worked note, validated 1:1 against `VideoAnalysisSchema`. It is the gate almost everything downstream sits behind. |
| Text pass versus layout | Analyze owns only the text columns (hook, structure, format, style, why). The five layout columns on the same row come from a separate frame pass with its own model and its own timestamp, and a re-analysis never touches them. |
| The analyze gate | `AnalysisGate` on the video detail page picks one of four faces from whether the video already has a transcript, whether a transcript provider is reachable right now, and whether the Claude key is set. |
| Cache-first, on-demand | `getOrCreateAnalysis` returns the stored row on a cache hit without touching the transcript chain or the model at all. A miss creates a transcript on demand, provided the video has a downloaded asset, before calling the model. |
| Idea | The one row per video Generate idea writes into the `idea` table: a one-line concept and a short angle asked from the video's analysis and the creator's persona, capped at one non-discarded idea per video by the `idea_source_active` partial index. |
| The sync's own passes | The sidecar sync runs `autoAnalyzeNewOutliers` (analyzes a channel's top unanalyzed outliers, capped at 10) and then `generateIdeasForNewOutliers` (turns the newly analyzed ones into ideas, capped at 20), both gated on the same `OUTLIER_IDEA_THRESHOLD` (3) and both never throwing, so one bad candidate never stops the sync. |

## 4. How it fits in the system

Analyze sits between the videos a sync already wrote and everything in the app that reasons about why a video worked. It never talks to Instagram and never writes the `videos` table itself; it reads a video's caption, duration, view count, and outlier score, and it depends on ig-sync having already downloaded the video's own asset before a transcript can be made. On the video detail page, the Hook and structure and Why it worked tabs render the analyze gate until a `video_analyses` row exists, then render the result plus a Re-analyze control. The same page's action row carries Generate idea, gated on the same analysis existing. Downstream, remix reads a video's analysis to describe the source post, and save to vault is offered only once an analysis exists. The sidecar sync also drives analyze and idea generation on its own, without a user in the loop, over a channel's newest top outliers, so the ideas inbox has content to work with even before the user opens a single video.

## 5. Dependency map

### Upstream (what analyze depends on)

| Dependency | Why |
| --- | --- |
| SQLite database via drizzle (`src/server/db`) | The tables analyze reads and writes: `videos`, `transcripts`, `video_analyses`, `idea`. |
| [The llm layer](../llm/01-concept-brief.md) (`src/server/llm/client.ts`) | `getLlm`, `resolveModel`, and `hasLlmKey` are how analyze and Generate idea reach Claude, direct or through a local proxy; `NoApiKeyError` is what a missing key throws before any request is made. |
| The transcribe layer (`src/server/transcribe`) | `getOrCreateTranscript` is the cache-first whisper.cpp then Groq chain analyze calls on a cache miss; it needs the video's own downloaded asset and throws `VideoNotDownloadedError` when that asset is not there yet. |
| The media store (`src/server/media/store`) | `getAsset`/`resolveAssetPath` resolve the local file transcription reads bytes from. |
| The persona (`src/server/services/persona.ts`) | `getPersona` supplies the single audience, voice, do, and don't row Generate idea's prompt is built from. |
| The app secret store | `ANTHROPIC_API_KEY` and `GROQ_API_KEY`, database first, environment fallback; whether either is set decides which gate face and which transcript providers are offered. |
| ig-sync | The writer of the `videos` row and of the downloaded video asset analyze's transcript step depends on; it also calls analyze and idea generation directly, as its own automatic pass, once a sync's page walk and scoring finish. |

### Downstream (what depends on analyze)

| Consumer | What it reads |
| --- | --- |
| Video detail page (Hook and structure tab, Why it worked tab) | The analyze gate, the stored analysis, and the Re-analyze control; the whole reason this component exists on that page. |
| Save to vault | Gated on `detail.analysis` existing; offered only once a video has been analyzed. |
| remix | Reads a video's `video_analyses` row (through the same `rowToAnalysis` mapping analyze itself uses) to describe the source video's hook and structure. |
| Ideas inbox | The `idea` rows Generate idea and the sync's automatic pass write; the inbox screen itself is a separate surface out of scope for this repo. |
| ig-sync's sync pass | Calls `autoAnalyzeNewOutliers` and `generateIdeasForNewOutliers` directly, in order, near the end of every channel's sync. |

### External

| Dependency | Role |
| --- | --- |
| Anthropic API (Claude) | Reached directly, or through a local OpenAI-compatible proxy when `LLM_BASE_URL` is set, for both the text analysis and the idea generation calls. |
| Groq (`whisper-large-v3-turbo`) | An external transcription provider, used only when `GROQ_API_KEY` is set and whisper.cpp is unavailable or fails. |
| whisper.cpp | A local binary plus a downloaded GGML model; the keyless, fully local transcription path. |

## 6. Boundaries

Analyze owns the text pass over a video: resolving or creating its transcript, calling the model through the [llm layer](../llm/01-concept-brief.md), and writing the one `video_analyses` row's text columns (hook, structure, format tags, style tags, why). It owns Generate idea's on-demand button and the `idea` row it writes, and it owns the shared services (`getOrCreateAnalysis`, `generateIdea`) the sync's automatic passes reuse. It does not own the layout of a video: that is a separate frame pass, run from the Layout tab with its own model and timestamp, which a re-analysis deliberately leaves untouched. It does not own transcription itself, a separate keyless-capable path, nor the model client, the llm layer. It does not own the ideas inbox: Generate idea is an exit from the core loop, and the inbox screen where the idea lands is out of scope for this repo. Success and failure surface only as toasts; the two dead-end states (no transcript provider, no key) render as alerts in the analyze gate rather than as toasts. Whether a Kit install can complete a real analysis end to end, with a live Claude key and no local proxy in front of it, is called out as unverified in [packaging and release](../../shared/packaging-and-release.md).
