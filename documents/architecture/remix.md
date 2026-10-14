# Remix

Remix is the six-stage studio at `/feed/{videoId}/remix` that turns one analyzed source video into a script in the buyer's own voice. The stages are prompt, research, hook, style, script, and finish. It ends with a script and a draft planned post, ready for studio to cook. Hook, style, and script call a model through the llm layer; prompt, research, and finish make no model call.

It is split into stages because generation is slow and fails often. A buyer can stop after any stage, a failed generation leaves the prior value intact plus a logged trace, and Quick Remix collapses the pipeline to one click.

## Data it holds
- `remix_sessions` (`src/server/db/schema.ts`): one row per source video, a mutable scratchpad (topic, niche, target length, research notes, hook options, chosen hook, style vault item id, outline, variants, chosen variant index). `stage` is the furthest stage reached.
- `remix_runs`: one row per generation attempt (hook, style, script), written on success and failure. Index `remix_runs_session_started` on `(session_id, started_at)`. Cascades with the session.
- Writes into `scripts` and `planned_posts`, which it shares with the vault and mine. Both reference the session with `set null` on delete and carry copies of the text, so deleting a session costs only run provenance.
- Reads `videos`, `video_analyses`, `transcripts`, `vault_items`, `saved_posts`, `app_settings` (`niche_profile`), and ideas.

## Boundaries
- Owns: `src/components/remix/*`, `src/server/services/remix.ts`, `src/server/services/prompts/remix-prompts.ts`, `src/server/actions/remix-actions.ts`, `src/server/queries/remix-runs.ts`, and the page `src/app/(shell)/feed/[videoId]/remix/page.tsx`.
- Called by: the feed video detail page; vault template cards via `?hook=` and `?style=` deep links; the keyless MCP tools `crowsnest_remix_*` (`src/server/mcp/mcp-server.ts`).
- Calls: `getLlm` in the llm layer, `getSimilarOutliers` (similar.ts), `getPersona` (persona.ts), `rowToAnalysis` (analyze.ts). No external service directly.
- Does not own: analysis, vault templates, the model transport, the ideas inbox (`seedSessionFromIdea` only links an idea and marks it `scripted`), or cooking the plan (studio).

## Invariants
- One session per source video. `getOrCreateSession` reuses the latest row by `sourceVideoId` or inserts one at stage `prompt` (`remix.ts`).
- `updateStage` writes only the fields present in the patch, so nullable fields can be cleared. Back and stepper clicks move only the client's active stage; Continue and Quick Remix advance `stage`.
- A failed generation never overwrites the previous value; it only appends a `remix_runs` row. `remix.ts` is the only writer of `remix_runs`.
- Research makes no model call: source analysis, a 500-character transcript excerpt, and the top 5 similar outliers. A failed assembly clears the skeleton for an error and Retry (`stage-research.tsx`).
- Variants generate in parallel with `Promise.allSettled`; failed slots do not persist. A single-slot regenerate rewrites only that slot.
- `generateOutline` clears `variants` and `chosenVariantIndex` in the same write as the new outline. A hand edit through `updateStage` does not.
- `chosenHook` stores raw text, so `scripts.hookVaultItemId` is always null. `chosenVariantIndex` null is a real state, never coerced to 0; finish shows an explicit placeholder.
- `remixSessions.styleVaultItemId` is a plain text column with no database foreign key; `scripts.styleVaultItemId` is the enforced one.
- Proxy-down is inferred, not pinged: the stages block while any of the three newest run log rows is a connection failure (`isProxyLikelyDown` in `run-log-view.ts`). Quick Remix gates on the same signal.
- `finishRemix` is idempotent. It runs `reconcileAttachedScript` so the plan's script matches the current chosen variant, then reuses the latest linked plan or inserts an undated draft. The "Add to plan" control on the script stage is a separate path that creates a dated plan. Nothing at the database level stops two truly concurrent finishes from both inserting (no unique constraint on `planned_posts.remix_session_id`).
- Two paths share this service and converge on `finishRemix`. In-app calls `generate*` and needs a key or proxy. MCP calls `build*Prompt`, which returns `{ system, user, context }` for the calling agent to fulfill, then saves back through `crowsnest_remix_choose_hook`, `crowsnest_remix_outline` (called again with an `outline`), and `crowsnest_remix_save_script`. The outline save-back matters because `buildScriptPrompt` reads `session.outline`. There is no `crowsnest_remix_regenerate_variant` (`mcp-remix-keyless.test.ts`).
- Stage motion respects `motion-reduce`; the stepper connector never uses amber or green.

## Where to look
- `src/server/services/remix.ts` (all logic, tested in `remix.test.ts`)
- `src/server/services/prompts/remix-prompts.ts`
- `src/components/remix/remix-studio.tsx` (shell, stepper, Quick Remix)
- `src/components/remix/run-log-view.ts` (proxy-down inference)
- `src/components/remix/deep-link.ts`
- `src/server/mcp/mcp-server.ts` (`crowsnest_remix_*`)
