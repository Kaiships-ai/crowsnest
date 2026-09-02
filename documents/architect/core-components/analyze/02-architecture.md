# analyze: architecture

The interaction, event by event, is described in [feature description](03-feature-description.md)
and exercised in [test cases](04-test-cases.md); this document covers the files and the
data flow behind them.

## Key files

- `src/components/video/video-detail.tsx`: the video detail page. Holds the analyze
  gate (`AnalysisGate`, which picks one of four faces from `hasTranscript`, `hasKey`,
  and `canTranscribe`), the Re-analyze control by the Beats heading, and the Generate
  idea button in the action row. Pending state is plain component state, not a
  transition, so the disabled button is the only thing the wait blocks.
- `src/app/(shell)/feed/[videoId]/page.tsx`: the server read that decides the gate's
  face. It resolves `hasLlmKey()`, `availableTranscriptProviders()` (into
  `canTranscribe`), and whether the detail carries a transcript, and threads them into
  `VideoDetail`.
- `src/server/actions/analyze-actions.ts`: `analyzeVideoAction` and
  `reanalyzeVideoAction`, thin `"use server"` wrappers over the service that translate
  errors into `{ ok, error }`. They carry no `code` field (unlike most actions), so the
  client branches on success or failure only — the open backlog item is B-17a in
  [backlog to enhance](05-backlog-to-enhance.md). `runFramePassAction` also lives here
  but belongs to the separate frame pass, not text analysis.
- `src/server/services/analyze.ts`: `getOrCreateAnalysis`, the real logic — cache
  lookup, on-demand transcription, the model call, and the write. Fully covered by
  `analyze.test.ts`.
- `src/server/services/prompts/analyze-prompt.ts`: `ANALYZE_SYSTEM` and
  `buildAnalyzeUser`, the system and user prompts fed to the model.
- `src/server/llm/schemas.ts`: `VideoAnalysisSchema`, validated 1:1 against what the
  text model returns, and `IdeaSchema` (`concept` + `angle`).
- `src/server/llm/client.ts`: `getLlm`, `resolveModel`, `hasLlmKey`, and
  `NoApiKeyError` — the [llm layer](../llm/01-concept-brief.md) analyze reaches the
  model through.
- `src/server/transcribe/index.ts`: `getOrCreateTranscript`,
  `availableTranscriptProviders`, and `NoTranscriptProviderError`.
- `src/server/actions/idea-actions.ts` and `src/server/services/ideas.ts`:
  `generateIdeaAction` over `generateIdea` (the idea upsert), plus
  `generateIdeasForNewOutliers`, the sync's automatic idea pass.
- `src/server/services/auto-analyze.ts`: the sync's automatic analyze pass over a
  channel's top unanalyzed outliers (cap `AUTO_ANALYZE_CAP` = 10).
- `src/server/db/schema.ts`: the `video_analyses` table (one row per video) and the
  `idea` table (uniqueness enforced by the partial index `idea_source_active`).

## Data flow

**The read.** The detail page reads four facts on the server — does the video have an
analysis, a transcript, is the Claude key set, is a provider reachable — and
`AnalysisGate` picks its face from them. An already-analyzed video shows the result and
the Re-analyze control instead of a gate.

**Analyze.** A click runs `analyzeVideoAction` → `getOrCreateAnalysis(videoId)`. A cache
hit returns the stored text fields without touching the transcript or the model. On a
miss it reads the stored transcript or, if there is none, calls
`getOrCreateTranscript` (cache-first whisper.cpp → Groq), then resolves the client with
`getLlm()` (which throws `NoApiKeyError` when unkeyed) and calls `generateParsed`
against `VideoAnalysisSchema`. The parsed text fields plus `resolveModel()` are inserted
as one `video_analyses` row; there is no partial write. On success the action returns
`{ ok: true }`, the client toasts and calls `router.refresh()`; on failure
`errorMessage` maps `NoApiKeyError` / `NoTranscriptProviderError` / SDK errors to a
string toast and nothing is written.

**Re-analyze.** `reanalyzeVideoAction` → `getOrCreateAnalysis(videoId, { force: true })`,
which updates only the text columns (hook, structure, format, style, why) and leaves the
layout columns, the frame-pass provenance, and `createdAt` alone — a text pass has seen
no frames.

**Generate idea.** `generateIdeaAction` → `generateIdea`, which reads the video's
`video_analyses` row and the single persona, asks the model, and upserts one `idea` row
keyed on `sourceVideoId`. It rewrites only an untouched `inbox` idea; a shortlisted or
scripted one is left as the user left it. `generateIdea` never throws — a bad reply
comes back as `{ id: "", created: false }` — so the same call is safe to run per outlier
in the sync's automatic pass.

## Decisions

- **Layout is not analysis.** `StoredVideoAnalysis` is a strict superset of the text
  model's `VideoAnalysis`; the layout columns are written only by a separate frame pass
  with its own model and timestamp. `getOrCreateAnalysis` returns the plain text shape,
  and a re-analysis never touches layout, so a text pass can never misattribute a frame
  reading it did not do.
- **Cache-first, on-demand, keyed by video id.** The one row per video is the cache; a
  hit skips the transcript chain and the model entirely. Transcription is created on
  demand only on a miss, so a freshly synced video is analyzable without a separate
  transcribe step.
- **Analyze actions omit the `code` field.** Unlike most core-loop actions they return
  only `{ ok, error }`, so a failure surfaces as a raw string toast the client cannot
  tell apart — carried as open item B-17a in [backlog to enhance](05-backlog-to-enhance.md).
- **The `videoAnalyses.summary` column is never written by the analyze pass** — see the
  confirmed-at-data-level finding in ANALYZE-09 of [test cases](04-test-cases.md).
- **One idea per video, enforced in the DB.** The `idea_source_active` partial index is
  the backstop; the service does a select-then-update upsert because that partial index
  is not a target `onConflictDoUpdate` can name.

## Open, not verified end to end

Per `documents/architect/shared/packaging-and-release.md`, a Kit install has not been
proven to complete a real AI analysis with real credentials, and the no-proxy LLM path
(hitting the Anthropic API directly, no local router) is unverified end to end.
