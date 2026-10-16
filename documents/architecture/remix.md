# Remix

Remix is the six-stage studio at `/feed/{videoId}/remix` that turns one analyzed source video into a script in the buyer's own voice. The stages are prompt, research, hook, style, script, and finish. It ends with a script and a draft planned post, ready for studio to cook. The app makes no model call at any stage. Hook, style, and script text is written by an outside agent (Claude) over the keyless MCP chain; each of those stages shows what the agent wrote and a "Copy prompt for Claude" button (`copy-prompt-button.tsx`) that copies the MCP steps for that stage. The buyer pastes it into Claude, then reloads the page to see the result.

It is split into stages so a buyer can stop after any stage and resume where they left off.

## Data it holds
- `remix_sessions` (`src/server/db/schema.ts`): one row per source video, a mutable scratchpad (topic, niche, target length, research notes, hook options, chosen hook, style vault item id, outline, variants, chosen variant index). `stage` is the furthest stage reached.
- `remix_runs`: kept in the schema for existing rows and migration history. Nothing writes or reads it.
- Writes into `scripts` and `planned_posts`, which it shares with the vault and mine. Both reference the session with `set null` on delete and carry copies of the text, so deleting a session costs only the link back to it.
- Reads `videos`, `video_analyses`, `transcripts`, `vault_items`, `saved_posts`, `app_settings` (`niche_profile`), and ideas.

## Boundaries
- Owns: `src/components/remix/*`, `src/server/services/remix.ts`, `src/server/services/prompts/remix-prompts.ts`, `src/server/actions/remix-actions.ts`, and the page `src/app/(shell)/feed/[videoId]/remix/page.tsx`.
- Called by: the feed video detail page; vault template cards via `?hook=` and `?style=` deep links; the keyless MCP tools `crowsnest_remix_*` (`src/server/mcp/mcp-server.ts`).
- Calls: `getSimilarOutliers` (similar.ts), `getPersona` (persona.ts), `rowToAnalysis` (analyze.ts). No external service directly.
- Does not own: analysis, vault templates, the ideas inbox (`seedSessionFromIdea` only links an idea and marks it `scripted`), or cooking the plan (studio).

## Invariants
- One session per source video. `getOrCreateSession` reuses the latest row by `sourceVideoId` or inserts one at stage `prompt` (`remix.ts`).
- `updateStage` writes only the fields present in the patch, so nullable fields can be cleared. Back and stepper clicks move only the client's active stage; Continue advances `stage`.
- Research makes no model call: source analysis, a 500-character transcript excerpt, and the top 5 similar outliers. A failed assembly clears the skeleton for an error and Retry (`stage-research.tsx`).
- A hand edit in the Script or Style stage writes only the one variant or beat that changed, through `editVariant` or `editBeat`, merged into the stored list on blur. A tab opened before an agent save never drops the agent's entries, and a blur with no change writes nothing. An edit to a slot the agent removed is not saved: the action returns `ok: false`, the stage shows an Autosave failed toast that says to reload, and the edit stays unsaved so the next blur retries it. Two edits to the same beat or variant are last writer wins.
- `updateStage` refuses a `chosenVariantIndex` outside the stored variants, so a pick from a stale tab, or `saveScript` with a stale index, never stores an index with no variant behind it.
- `editBeatAction` checks the beat against `OutlineSchema` and `editVariantAction` requires text, so a malformed edit never reaches the stored outline.
- `saveAgentScript` is idempotent by session and text: a repeated save with the same text returns the same `scriptId` and picks that variant again. The title is not part of the match, so a retry with a new title keeps the first title.
- Hook, style, and script render only stored text: `hookOptions`, `chosenHook`, `outline`, and `variants` on the session. Each stage with nothing stored shows an empty line pointing at the copy button.
- Script Continue is enabled once a variant or a saved script exists (`remix-studio.tsx`).
- `chosenHook` stores raw text, so `scripts.hookVaultItemId` is always null. `chosenVariantIndex` null is a real state, never coerced to 0; finish shows an explicit placeholder.
- `remixSessions.styleVaultItemId` is a plain text column with no database foreign key; `scripts.styleVaultItemId` is the enforced one.
- `finishRemix` is idempotent. It runs `reconcileAttachedScript` so the plan's script matches the current chosen variant, then reuses the latest linked plan or inserts an undated draft. The "Add to plan" control on the script stage is a separate path that creates a dated plan. Nothing at the database level stops two truly concurrent finishes from both inserting (no unique constraint on `planned_posts.remix_session_id`).
- Text comes in through MCP only. `crowsnest_remix_hooks`, `crowsnest_remix_outline`, and `crowsnest_remix_variants` call `build*Prompt`, which returns `{ system, user, context }` for the calling agent to fulfill, then saves back through `crowsnest_remix_choose_hook`, `crowsnest_remix_outline` (called again with an `outline`), and `crowsnest_remix_save_script`. `crowsnest_remix_choose_hook` also stores the agent's full list in `hookOptions` when it passes `hooks`. An outline save clears `variants` and `chosenVariantIndex`, because they were written from the old beats. `crowsnest_remix_save_script` calls `saveAgentScript`, which in one transaction appends the script to `variants`, picks it, and saves it, so the Script and Finish stages show it. A save with text already in `variants` picks that variant and returns its existing script instead of adding a duplicate. The outline save-back matters because `buildScriptPrompt` reads `session.outline`. There is no `crowsnest_remix_regenerate_variant` (`mcp-remix-keyless.test.ts`).
- Stage motion respects `motion-reduce`; the stepper connector never uses amber or green.

## Where to look
- `src/server/services/remix.ts` (all logic, tested in `remix.test.ts`)
- `src/server/services/prompts/remix-prompts.ts`
- `src/components/remix/remix-studio.tsx` (shell, stepper)
- `src/components/remix/copy-prompt-button.tsx` (`buildClaudePrompt`)
- `src/components/remix/deep-link.ts`
- `src/server/mcp/mcp-server.ts` (`crowsnest_remix_*`)
