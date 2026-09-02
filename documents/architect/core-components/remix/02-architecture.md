# remix: architecture

## Key files

- `src/app/(shell)/feed/[videoId]/remix/page.tsx`: the server entry. Loads the video
  detail, gets or creates the session, and reads the vault hooks, vault styles, saved
  posts, and niche in one `Promise.all`, then hands them to the studio. Resolves the
  `?hook=` / `?style=` deep-link params from a vault template card.
- `src/components/remix/remix-studio.tsx`: the client shell. Holds the session row in
  local state, tracks the active stage vs. the furthest reached, owns Back / Restart /
  Continue and Quick Remix, and re-reads the run log after each generation.
- `src/components/remix/stage-{prompt,research,hook,style,script,finish}.tsx`: the six
  stage surfaces. Plus `stepper.tsx` (`STAGE_ORDER`), `context-rail.tsx`, `run-log.tsx`,
  `run-log-view.ts` (`isProxyLikelyDown`), `generation-blocked.tsx`, `steer-box.tsx`,
  `grounded-in.tsx`, `autosave.ts`, and `deep-link.ts` (`resolveDeepLinkSeed`, pure and
  unit-tested).
- `src/server/services/remix.ts`: all real logic. `getOrCreateSession`, `updateStage`,
  `buildResearch`, `generateHooks`, `generateOutline`, `generateVariants`, `saveScript`,
  `reconcileAttachedScript`, `finishRemix`, `quickRemix`, `seedSessionFromIdea`.
- `src/server/actions/remix-actions.ts`: thin `"use server"` wrappers, one per stage
  action plus `quickRemixAction` and `getRemixRunLogAction`, all returning a discriminated
  `{ ok }` result and mapping `NoApiKeyError` to the "add your key" message.
- `src/server/services/prompts/remix-prompts.ts`: the hook / outline / script system and
  user prompt builders.
- `src/server/queries/remix-runs.ts`: read-only run-log query (newest first).
- `src/server/db/schema.ts`: `remixSessions` and `remixRuns` tables.
- Reads from: `src/server/services/similar.ts` (`getSimilarOutliers`),
  `src/server/services/persona.ts` (`getPersona`), `src/server/services/analyze.ts`
  (`rowToAnalysis`), `src/server/llm/client.ts` (`getLlm`, `hasLlmKey`), and
  `src/lib/script-title.ts` (`deriveScriptTitle`).

## Data flow

**Session.** One `remix_sessions` row per source video. `getOrCreateSession` reuses the
latest by `sourceVideoId` or inserts a fresh row at stage `prompt`. The row is a mutable
scratchpad: `topic`, `niche`, `targetLengthSec`, `researchNotes` (JSON), `hookOptions`
(JSON), `chosenHook` (raw text), `styleVaultItemId`, `outline` (JSON-stringified in a text
column), `variants` (JSON), and `chosenVariantIndex`. Every stage autosaves into it through
`updateStage`, which sets only the fields present in a `Partial<StagePatch>` (so nullable
fields like `styleVaultItemId` and `chosenVariantIndex` can be cleared, not just set).

**Research.** `buildResearch` makes no model call. It reads the source `video_analyses`
row (stripped to `StoredAnalysisFields`), a transcript excerpt capped at 500 chars, and the
top 5 similar outliers, writes them to `researchNotes`, and returns them. That is why the
research stage works with no key and the proxy down.

**Generation.** `generateHooks`, `generateOutline`, and `generateVariants` each read the
session, build a prompt from `remix-prompts.ts` (grounded in the source's `hookType`,
structure segments, and `whyItWorked`, plus topic/niche/facts, with the persona appended by
`withPersona`), call the model via `getLlm()`, persist the result to its own column, and
call `recordRun` inside their own try/catch so a `remix_runs` row lands on both success and
failure. Variants generate in parallel via `Promise.allSettled`; a rejected slot becomes
`{ error }` at its index and only successful slots persist. A single-slot regenerate
(`opts.index`) read-modify-writes just that slot. The run log's `isProxyLikelyDown` scans
the last three rows for a connection failure to decide the generation-blocked posture.

**Finish.** `finishRemix` is the one durable non-generation write and is idempotent. It
finds the most recent `planned_posts` row linked to the session, runs
`reconcileAttachedScript` (writes a `scripts` row matching the current chosen variant, or
reuses a matching one), then reuses that plan or inserts a new undated `draft` plan, and
returns its `postId` for the link into `/mine/{postId}/studio`.

**Quick Remix.** `quickRemix` runs research → hooks (auto-picking the first) → outline →
variants sequentially and lands the session at stage `script`, every earlier stage still
reachable.

## Decisions

- **One session per source video, reused on return.** Mirrors analyze's cache-or-create
  shape. Resuming where the buyer left off is the intended UX, so `getOrCreateSession`
  keys on `sourceVideoId` and orders by `updatedAt`.
- **`remix_runs` is its own table, not a JSON column.** A run log is append-only
  independent facts; a JSON blob would mean reading the whole history to append one row and
  would race the session's own frequent field writes. It is the studio's status surface,
  and it survives a Restart (which only resets `stage`) and a reload by construction.
- **The session is disposable; the script and plan carry copies.** `saveScript` and
  `reconcileAttachedScript` copy the chosen variant's text into `scripts.content`, so a
  deleted session costs only the "which run made this" provenance (the FK is `set null`).
- **`chosenHook` and `chosenVariantIndex` never fabricate a default.** `chosenHook` stores
  raw text, not a vault-item id, so nothing links a saved script back to a seeding vault
  hook. `chosenVariantIndex` null is a real state, never coerced to 0, so finish shows an
  explicit "(no variant picked yet)" rather than plausible words the buyer never chose.
- **Proxy-down is inferred from the run log, not a live ping.** A connection-style error in
  the last three attempts marks the generation stages blocked; the next success clears it.
- **All logic lives in `remix.ts`; actions are thin wrappers.** The service is fully unit-
  tested (`remix.test.ts`); the `"use server"` layer only maps errors and shapes results.

See [03-feature-description.md](./03-feature-description.md) for per-stage behavior and
[05-backlog-to-enhance.md](./05-backlog-to-enhance.md) for known gaps (stuck research
skeleton, stale variants after an outline regenerate, Quick Remix not blocked when the
proxy is down).
