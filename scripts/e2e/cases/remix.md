# Remix cases

## Built features

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Set the topic, niche, and length | Stores the session's topic and target length; the niche is read from settings | ● | `remix-actions.ts` (`updateStageAction`), `crowsnest_remix_set_prompt`, `remix.ts` (`getNicheProfile`) | none |
| 4 | Assemble the research | Assembles the source analysis, a transcript excerpt, and similar outliers with no model call | ● | `remix.ts` (`buildResearch`), `crowsnest_remix_research` | B-02 |
| 5 | Pick a hook | Returns a hook prompt for the agent and stores the hook it chose | ● | `remix.ts` (`buildHookPrompt`), `crowsnest_remix_hooks`, `crowsnest_remix_choose_hook` | none |
| 6 | Shape the outline | Returns an outline prompt and stores the beats the agent saved; a hand edit changes one beat | ● | `remix.ts` (`buildOutlinePrompt`, `editBeat`), `crowsnest_remix_outline` | none |
| 7 | Save a script | Returns a script prompt, stores each agent script as a picked variant, and saves a variant as a script | ● | `remix.ts` (`buildScriptPrompt`, `saveAgentScript`, `saveScript`, `editVariant`), `crowsnest_remix_variants`, `crowsnest_remix_save_script` | none |
| 8 | Finish: put the remix on the plan | Creates or reuses a planned post carrying the currently chosen script | ● | `remix.ts` (`finishRemix`), `crowsnest_remix_finish` | none |

The web app's six-stage remix studio screen is retired with the web app; a Lead Studio board replaces it. Every rule below lives in `src/server/services/remix.ts` and the MCP chain.

### Business rules

- One session per source video: `getOrCreateSession` reuses the latest row by `sourceVideoId`. `stage` on the session is the furthest stage reached.
- The niche is read through `getNicheProfile`, the same lookup the prompt builders use, falling back to "general short-form content" when unset.
- Research makes no model call. `buildResearch` assembles why it worked, the hook pattern, the structure beats, a transcript excerpt capped at 500 characters, and the top 5 similar outliers.
- No stage makes a model call or needs a key. `crowsnest_remix_hooks`, `crowsnest_remix_outline`, and `crowsnest_remix_variants` return `{ system, user, context }` for the agent to fulfill; the agent saves back through `crowsnest_remix_choose_hook`, `crowsnest_remix_outline` (with an `outline`), and `crowsnest_remix_save_script`.
- With a vault hook seed, `buildHookPrompt` takes that `vaultItemId`'s template text as the hook pattern. Choosing a hook stores the line's raw text, so `scripts.hookVaultItemId` is always null.
- An outline save clears `variants` and `chosenVariantIndex`, because they were written from the old beats.
- `saveAgentScript` appends the script to `variants` and picks it in one transaction, and is idempotent for identical text.
- A hand edit writes only the one variant or beat that changed (`editVariant`, `editBeat`); an edit to a slot the agent removed returns `ok: false`.
- `finishRemix` is idempotent. It reconciles the plan's script to the current chosen variant, then reuses the latest linked plan or inserts an undated draft. Finishing with nothing picked still creates an undated draft with a derived title and no script.

### Interactions with other systems

- The session reads the source video and its analysis, both written earlier by the sidecar sync and by analyze. Remix starts no background job of its own; the cook run that follows a finish belongs to studio.
- No stage calls a model. Hook, style, and script text comes from the agent over MCP. See [external services](../../../documents/architecture/external-services.md).
- There is no undo. A new save from the agent replaces a field's value outright.

### Edge cases

- If the source video is removed by a sync mid-session, the session keeps its own copied topic, hooks, outline, and variants; a later prompt that needs the source's analysis falls back to a default pattern rather than failing.
- Two callers on the same video share one session, since get or create always returns the same row; their writes and the agent's MCP writes race, last write wins per field.

## remix: test cases

Result markers: 🟢 pass, 🔴 bug, 🟡 blocked (missing dependency named in the cell). Rows still reading "not run" were not driven in QA round 1.

How to run these: the route and action rows run offline with `pnpm test --project crowsnest` (vitest) against a temporary SQLite database, no model and no external service needed. The web app's behavior cases, browser journeys, and its :3001 dev server are retired with the web app; a UI case returns when its Lead Studio board is built.

## 1. behavior

Retired with the web app (the remix studio screen no longer exists): REMIX-01 through REMIX-07, REMIX-11 through REMIX-15, REMIX-17, REMIX-19, REMIX-21 through REMIX-30. Their server claims are covered in section 2.

## 2. route and action

| ID | P | Layer | Claim | Setup | Call | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ACTION-01 | P1 | server action (`src/server/services/remix.ts :: getOrCreateSession`) | Reuses the latest session for a source video by `sourceVideoId`, ordered by `updatedAt`, rather than creating a duplicate. | A `remixSessions` row already exists for a video. | `getOrCreateSession(videoId)` a second time. | The same session id is returned; no second row is inserted. | 🟢 covered by vitest (green) |
| ACTION-02 | P1 | server action (`src/server/actions/remix-actions.ts :: updateStageAction`) | A partial patch sets only the fields given; `styleVaultItemId` and `chosenVariantIndex` can be explicitly cleared back to null, not merely set. | A session with `styleVaultItemId` and `chosenVariantIndex` both set. | `updateStageAction(id, { styleVaultItemId: null })`, then `updateStageAction(id, { chosenVariantIndex: null })`. | Each field reads back null after its own call; the other untouched fields are unchanged. | 🟢 covered by vitest (green) |
| ACTION-03 | P1 | server action (`src/server/services/remix.ts :: buildResearch`) | Assembles source analysis, a transcript excerpt capped at 500 characters, and the top 5 similar outliers with zero model calls, and persists them to `researchNotes`. | A session whose source video is analyzed and transcribed. | `buildResearch(id)`. | The returned notes and the session's `researchNotes` column match; no model is called. | 🟢 covered by vitest (green) |
| ACTION-05 | P1 | server action (`src/server/services/remix.ts :: buildHookPrompt`) | A seeded vault item's `templateText` is used as the hook pattern when `opts.vaultItemId` is given; a missing or empty lookup falls back to the source's `hookType`. | A vault hook item and a session whose source has an analysis. | `buildHookPrompt(id, { vaultItemId })`, then again with a nonexistent id. | The first prompt is built from the vault item's text; the second falls back to `describeSourceHookPattern`. | not run: no vitest covers it |
| ACTION-06 | P1 | server action (`src/server/services/remix.ts :: buildOutlinePrompt`) | The structure in the outline prompt comes from the session's `styleVaultItemId` template when set, else the source's structure segments described in prose. | A session with `styleVaultItemId` set to a real vault style item. | `buildOutlinePrompt(id)`. | The built prompt's structure text matches the vault item's `templateText`, not the source's segments. | not run: no vitest covers it |
| ACTION-10 | P1 | server action (`src/server/services/remix.ts :: saveScript`) | Inserts a `scripts` row with `remixSessionId` set to the session and `hookVaultItemId` always null; when `variantIndex` is given it also sets the session's `chosenVariantIndex`. | A session with a generated variant. | `saveScript(id, content, title, 1)`. | A new `scripts` row exists with `remixSessionId: id`, `hookVaultItemId: null`; the session's `chosenVariantIndex` reads back `1`. | 🟢 covered by vitest (green) |
| ACTION-11 | P1 | server action (`src/server/services/remix.ts :: finishRemix`) | Reuses the most recent `plannedPosts` row already linked to the session by `remixSessionId`, rather than inserting a second. | A session with an existing linked plan. | `finishRemix(id)` twice. | Both calls return the same `postId`; `created` reads `false` on both, since the row already existed before the first call in this setup. | 🟢 covered by vitest (green) |
| ACTION-12 | P1 | server action (`src/server/services/remix.ts :: finishRemix`, `reconcileAttachedScript`) | Reconciles the plan's `scriptId` to the session's current `chosenVariantIndex` text, writing a fresh `scripts` row when the two have diverged, or reusing a matching one when found. | A session where a saved variant was later re-picked to a different, unsaved one. | `finishRemix(id)`. | A new `scripts` row is written matching the currently chosen variant's text; the plan's `scriptId` points at it, not the earlier stale save. | 🟢 covered by vitest (green) |
| ACTION-13 | P2 | server action (`src/server/services/remix.ts :: finishRemix`, `reconcileAttachedScript`) | With no chosen variant, reconciliation returns the latest saved script untouched rather than inventing one. | A session with a saved script but `chosenVariantIndex` null. | `finishRemix(id)`. | No new `scripts` row is inserted; the plan carries the existing saved script's id. | 🟢 covered by vitest (green) |
| ACTION-14 | P1 | server action (`src/server/services/remix.ts :: finishRemix`) | The created `plannedPosts` row has `plannedDate` null, since finishing is not a scheduling decision. | A session with no existing plan. | `finishRemix(id)`. | The new row reads `plannedDate: null`, `state: "draft"`. | 🟢 covered by vitest (green) |
| ACTION-17 | P1 | server action (`src/server/actions/remix-actions.ts :: deleteScriptAction`) | Refuses to delete a script still carried by a planned post, naming the carrying plans; the schema's `set null` on delete is a backstop only, not the enforcement path. | A script attached to one planned post. | `deleteScriptAction(scriptId)`. | Returns `{ ok: false, code: "SCRIPT_CARRIED_BY_PLAN" }` naming the one plan; the script row is not deleted. | 🟢 covered by vitest (green) |
| ACTION-20 | P3 | server action (`src/server/services/remix.ts :: getNicheProfile`) | Reads the `app_settings` row keyed `"niche_profile"`, falling back to "general short-form content" when unset. | `app_settings` with no `niche_profile` row. | `getNicheProfile()`. | Returns the literal string "general short-form content". | 🟢 covered by vitest (green) |
| ACTION-21 | P1 | service (`src/server/services/remix.ts :: saveAgentScript`) | A hook list, outline, and script saved the way the MCP tools save them read back through `getOrCreateSession` with no model call. A later agent save beats an older variant at finish. | Migrated DB with a seeded video. | `updateStage` with `chosenHook` and `hookOptions`, then with `outline`; `saveAgentScript`; then `getOrCreateSession`. Second case: old variant picked, `saveAgentScript`, `finishRemix`. | The session carries the hooks and outline, `variants` holds the script with `chosenVariantIndex` 0, and finish attaches the agent's text. | 🟢 covered by vitest (`remix.test.ts`, agent-written stages) |
| ACTION-22 | P0 | service (`src/server/services/remix.ts :: saveAgentScript`, `editVariant`, `editBeat`) | Agent script saves are one transaction and idempotent for identical text, and `chosenVariantIndex` stays in range. | Migrated in-memory DB with a seeded video. | Concurrent and retried `saveAgentScript`, a failing `scripts` insert. | Both concurrent variants kept, a retry returns the same script id, a failed insert leaves no variant. | 🟢 covered by vitest (`remix.test.ts`) |

Not checkable by hand:

- Whether a truly concurrent double `finishRemix` on a session with no plan yet can both insert, since there is no unique constraint on `plannedPosts.remixSessionId` backing the read-then-write (open questions, see [architecture](../../../documents/architecture/remix.md)).
- What a real agent writes through MCP, which depends on the agent, not on crowsnest.

## 3. browse-e2e

Retired with the web app: E2E-01, E2E-03 through E2E-08, E2E-10 through E2E-12, E2E-14. No browser journey exists until a Lead Studio board is built.

## 4. security-lite

| ID | P | Threat | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-03 | P2 | No buyer data leaving the box | The prompts remix builds carry only the session's own text and the source video's stored analysis fields, never another table's rows or raw media. | A session with facts, a chosen hook, and an outline set. | 1. Inspect the `{ system, user }` strings `buildHookPrompt`, `buildOutlinePrompt`, and `buildScriptPrompt` return. | Each prompt contains only topic, niche, facts, hook or structure text, persona lines, and the source's `hookType` / `structureSegments` / `whyItWorked`; no other video's or channel's data appears. | not run |

Security-lite has no rows for a license gate or a sidecar shared-token check: remix has no license check of its own, and it never calls the sidecar or a model. "No buyer data leaving the box" is otherwise covered by SEC-03: remix has no outbound path; the prompt text it builds goes only to the MCP client that asked for it.
