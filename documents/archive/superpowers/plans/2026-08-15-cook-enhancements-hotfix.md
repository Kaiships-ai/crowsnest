# Cook enhancements hotfix implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise cook quality (beats carry transcript, per-beat layout, a real remix finish + a remix-scoped prompt, a calendar side panel) and fix the two live cook bugs (hooks-off, auto-inject).

**Architecture:** Enhancements 1 and 2 enrich the video analysis (per-beat transcript, per-beat layout). Enhancement 3 gives the remix a finish step and makes Create Prompt and brief.md read the remix session instead of the source video. Enhancement 4 moves the calendar detail into the existing Sheet. Enhancements 5 and 6 fix the cook spawn (setting-sources scoping) and the input path (server-side buffer).

**Tech Stack:** TypeScript, drizzle, Next server actions + client components, the LLM analyze pipeline, the frame-pass Claude subprocess, node-pty + ws, vitest.

**Spec:** docs/superpowers/specs/2026-08-15-cook-enhancements-hotfix-spec.md

**Branch:** feat/cook-enhancements-hotfix off main (main is at the merged cook feature, e0a1084 or later).

## Global Constraints

- npm/node are not on the default PATH; prefix commands with `export PATH="/opt/homebrew/bin:$PATH"`.
- Verification gate for every code task: BOTH `npm run typecheck` and the task's vitest files. typecheck runs the whole repo.
- Migrations: drizzle NNNN_words.sql, generate with `npm run db:generate`, never hand-write. Apply/test against a temp DB (CROWSNEST_DB_PATH), never data/crowsnest.db (known 0011-0013 desync).
- Decisions settled by Kai: D1 = analyze LLM emits per-beat transcript (not a time-slice). D3 = brief.md follows the planned post's remixSessionId to include the remix's hook/beats/layout. D5 = hooks-off via a live-tested --setting-sources value. D6 = server-side input buffer flushed on first session output.
- No fabricated data: absent fields render as a placeholder, never invented. The frame-pass anti-fabrication guard (frame-pass.ts:83) carries forward per beat.

## Build order

T1 beats transcript, T2 per-beat layout (both enrich analysis, feed T4/T5). Then T3 chosen-variant + finish stage, T4 remix prompt builder, T5 brief follows remixSessionId. Then T6 calendar (independent), T7 hooks-off, T8 auto-inject. T7 and T8 are independent of the UI work and can go anytime.

---

### Task 1: beats carry a per-beat transcript

**Files:**
- Modify: `src/server/llm/schemas.ts` (VideoAnalysisSchema.structureSegments), `src/server/db/schema.ts` (structureSegments `$type`), `src/server/services/prompts/analyze-prompt.ts` (ANALYZE_SYSTEM), `src/components/video/video-detail.tsx` (HookStructureTab)
- Test: the analyze schema parse test, and a component render assertion if the repo tests components.

**Interfaces:**
- Produces: each `structureSegment` gains `transcript: string` (the verbatim words spoken in that beat window).

- [ ] Step 1: widen the schema. In llm/schemas.ts, add `transcript: z.string()` to the `structureSegments` element (alongside label, startSec, endSec, note). In db/schema.ts:196 widen the `.$type<{ label; startSec; endSec; note; transcript }[]>()`. rowToAnalysis (analyze.ts:31) passes it through unchanged (it spreads the row).
- [ ] Step 2: instruct the model. In analyze-prompt.ts ANALYZE_SYSTEM, add to the structureSegments instruction: for each segment include `transcript`, the exact words spoken during that segment copied verbatim from the transcript, not paraphrased. Keep `note` as the short summary. The prompt already passes the full transcript (buildAnalyzeUser).
- [ ] Step 3: UI. In video-detail.tsx HookStructureTab (around :186), for each segment render the `transcript` (labelled "transcript", verbatim, styled as the prototype's purple-bordered block) above the existing `note` (labelled "summary"). Guard for older rows where `transcript` is absent (render only the note).
- [ ] Step 4: backfill. Re-analyzing a video repopulates structureSegments with transcripts. Note in the report that existing analyses show no per-beat transcript until re-analyzed (the Re-analyze affordance already exists, confirm its path).
- [ ] Step 5: verify (typecheck + the schema test + a parse test that a structureSegment with transcript validates). Commit: `feat(analyze): beats carry a verbatim per-beat transcript`.

---

### Task 2: per-beat layout

**Files:**
- Modify: `src/server/llm/schemas.ts` (VideoLayout), `src/server/db/schema.ts` (layout column type), `src/server/services/frame-pass-prompt.ts` (buildLayoutPrompt), `src/server/services/frame-pass.ts` (persistFramePass validation), `src/components/video/layout-section.tsx`
- Test: the layout parse/persist test.

**Interfaces:**
- Produces: `VideoLayout` becomes a per-beat array: `{ startSec, endSec, label, onScreenText, animation, demoCursor, toolDemo, textPosition, voicePace }[]`, each string field keeping its `fromFramesSec` provenance where the anti-fabrication guard needs it.

- [ ] Step 1: reshape the schema. In llm/schemas.ts, change `VideoLayout` from the flat 4-field object to `z.array(beatLayout)` where beatLayout has the beat key (startSec, endSec, label) plus the six fields. Decide per-field whether each keeps `{ value, fromFramesSec }` or the array carries one `fromFramesSec` per beat row; keep the anti-fabrication contract (a value requires a source frame). db/schema.ts:214 layout `$type` changes to the array.
- [ ] Step 2: the prompt. buildLayoutPrompt (frame-pass-prompt.ts:17) now receives the beats (structureSegments with startSec/endSec) and the sampled frames (each with timestampSeconds), and instructs the subprocess to emit one layout row per beat, mapping frames whose timestamp falls in the beat window, with the six fields. parseLayoutResult (frame-pass-prompt.ts:104) parses the array.
- [ ] Step 3: persist. persistFramePass (frame-pass.ts:72) validates and writes the array; the anti-fabrication guard (:83) applies per beat row.
- [ ] Step 4: UI. layout-section.tsx renders the per-beat table (the prototype's columns). Old flat layouts either migrate or show the existing "re-run frame pass" affordance; guard the render for both shapes or gate on the new shape and prompt a re-run.
- [ ] Step 5: verify (typecheck + a persist test that a per-beat layout validates and round-trips; the guard rejects a value with no source frame). Commit: `feat(frame-pass): per-beat layout synced to the beat timecodes`.

Note: this needs a frame-pass re-run per video to produce the new shape; it is not a free migration of the existing library.

---

### Task 3: remix chosen-variant and finish stage

**Files:**
- Modify: `src/server/services/remix.ts` (RemixStage, chosen variant), `src/server/db/schema.ts` (remix_sessions chosenVariantIndex), `drizzle/` (migration), `src/components/remix/stepper.tsx` (STAGES), `src/components/remix/remix-studio.tsx` (finish view + advancement), `src/components/remix/stage-script.tsx` (set chosen variant on save/pick)

**Interfaces:**
- Produces: `RemixStage` includes `"finish"`; `remix_sessions.chosenVariantIndex integer` set when a variant is chosen/saved; a finish view that opens the studio for the linked planned post.

- [ ] Step 1: chosen variant. Add `chosenVariantIndex: integer` to remix_sessions (schema.ts:296 block), generate migration, set it in saveScript / when the user selects a variant tab (stage-script.tsx). RemixSessionRow (remix.ts:27) gains the field.
- [ ] Step 2: finish stage. Add `"finish"` to `RemixStage` (remix.ts:11) and STAGES (stepper.tsx:9). remix-studio.tsx renders a finish view when activeStage === "finish": confirm the pick, ensure a planned post exists (reuse createPlannedPostAction if none), and link to the studio for that postId. The Continue button shows on the script stage now (advance to finish) and the finish view has the "Finish and open studio" action.
- [ ] Step 3: verify (typecheck + a remix action test that chosenVariantIndex persists and the finish stage advances). Commit: `feat(remix): finish stage and chosen-variant tracking`.

---

### Task 4: remix-scoped Create Prompt builder

**Files:**
- Modify: `src/server/services/export.ts` (new buildRemixPrompt), `src/server/actions/*` (the action wrapper), `src/components/remix/stage-script.tsx` (createPrompt calls the new builder)
- Test: export test for buildRemixPrompt.

**Interfaces:**
- Produces: `buildRemixPrompt(sessionId): Promise<string|null>` that reads the remix SESSION: source outlier (from the session's sourceVideoId), `chosenHook`, the beats with their per-beat transcript (Task 1) and per-beat layout (Task 2), and the chosen script variant (Task 3's chosenVariantIndex).

- [ ] Step 1: the builder. In export.ts add buildRemixPrompt(sessionId): load the remix session (remix.ts loader), the source video analysis (for the enriched beats + layout), and assemble the sections from the prototype: Source outlier, Chosen hook, Beats (transcript + summary), Layout per beat, Script (chosen variant). Reuse the section helpers where they fit.
- [ ] Step 2: wire it. stage-script.tsx createPrompt() (:148) calls a new `buildRemixPromptAction(session.id)` instead of `buildVideoPromptAction(session.sourceVideoId)`. Keep buildVideoPrompt for the video-detail Copy-as-Prompt (that surface is correct as source-scoped).
- [ ] Step 3: verify (typecheck + a test that buildRemixPrompt includes the chosen hook, a beat transcript, a per-beat layout row, and the chosen variant, and does not dump the whole source transcript). Commit: `feat(remix): Create Prompt reads the remix session, not the source video`.

---

### Task 5: brief.md follows remixSessionId

**Files:**
- Modify: `src/server/studio/write-brief.ts` (follow remixSessionId), `src/server/queries/studio.ts` (or a new query that joins the remix session)
- Test: write-brief test with a plan that has a remixSessionId.

**Interfaces:**
- Produces: writeBrief includes the remix session's chosenHook, the enriched beats (transcript + summary), and the per-beat layout, when the planned post has a remixSessionId.

- [ ] Step 1: load the session. In write-brief.ts (or getStudioBrief), when `plan.remixSessionId` is set, load the remix session and the source video analysis, and add to brief.md: `## Hook` (chosenHook), `## Beats` (per-beat transcript + summary from the analysis), `## Layout per beat` (the per-beat layout). Keep the existing Source outlier / Script / Target length / Video kind sections. When no remixSessionId, the brief is as today (no fabrication).
- [ ] Step 2: verify (typecheck + a write-brief test asserting the hook, a beat transcript, and a layout row appear when a remixSessionId is present, and are absent otherwise). Commit: `feat(studio): brief.md carries the remix hook, beats, and per-beat layout`.

---

### Task 6: calendar detail as a side panel

**Files:**
- Modify: `src/components/mine/mine-calendar.tsx` (reuse `src/components/ui/sheet.tsx`)

- [ ] Step 1: wrap in a Sheet. Move the detail block (mine-calendar.tsx:296-388) into a `Sheet` from src/components/ui/sheet.tsx, `open={selectedCell !== null}`, `onOpenChange` clears selectedKey, `side="right"`. Keep the selected cell's ring (:242). The fields and 5 actions move unchanged into the Sheet content. Escape and click-outside close come from the Sheet.
- [ ] Step 2: responsive + motion. Under 640px use the Sheet's bottom variant (side="bottom") via a breakpoint or the app's Sheet default. Confirm the slide is transform + opacity, ~220ms, and reduced-motion collapses to a fade. Action buttons get :active feedback if the app's Button does not already.
- [ ] Step 3: verify (typecheck + the existing mine-calendar tests still pass; add one asserting the detail renders inside the Sheet when a cell is selected). Commit: `feat(mine): calendar detail opens as a side panel`.

---

### Task 7: cook hooks-off actually suppresses SessionStart hooks

**Files:**
- Modify: `src/server/terminal/harness-profile.ts` (buildHarnessArgs / buildCookProfile)

Grounded: `--settings` is additive and cannot delete inherited hooks. The leak comes from user (`~/.claude/settings.json`) and, via the sandbox cwd walking into the repo, project (`.claude/settings.json`) SessionStart hooks. `--setting-sources` is a whitelist of sources to load.

- [ ] Step 1: live investigation (this is the load-bearing, must-test step). Spawn a throwaway claude from the sandbox cwd with candidate `--setting-sources` values and check which suppresses all SessionStart banners while keeping the cook working. Run from a data/workspace/videos/<slug>-style dir. Candidates to test, in order: `--setting-sources local`; then narrower if needed. For each, run `claude --plugin-dir <plugins/ksa> --permission-mode bypassPermissions --setting-sources <value> -p "print READY"` and a probe that asks the model to quote any MODE ACTIVE / vault-context line. The winning value shows no banner AND still authenticates AND still resolves ksa:cooking (test the plugin loads under that source scope).
- [ ] Step 2: apply. Add `--setting-sources <winning value>` to buildHarnessArgs (a new profile field settingSources, emitted when set), and set it in buildCookProfile. Keep `--settings` for anything still needed, or drop it if setting-sources alone does the job. Update harness-profile.test.ts for the new arg.
- [ ] Step 3: verify (typecheck + harness-profile.test + record the live probe output in the report showing no banner). Commit: `fix(cook): scope setting-sources so SessionStart hooks do not leak into the cook`.

If no --setting-sources value both suppresses the hooks and keeps the cook working (auth or plugin breaks under every scope), STOP and report the exact failure; do not ship a cook that cannot authenticate.

---

### Task 8: no lost keystrokes on Cook

**Files:**
- Modify: `src/server/terminal/ws.ts` (buffer input until the session is ready)

Grounded: cook() injects immediately (studio-panel.tsx:101); server `session?.write` drops input if the session is not spawned (ws.ts:170). No buffer.

- [ ] Step 1: buffer. In ws.ts, add a per-attach input queue. When a client `input` frame arrives and `session` is null (still queued / spawning), push the data onto the queue instead of dropping it. When the session is created and has produced its first output (the REPL is ready), flush the queue into the pty in order, then write directly thereafter. Use the session's first `onData` as the readiness signal (the claude REPL prompt), with a small fallback timeout so a silent start still flushes.
- [ ] Step 2: keep the invariants. Do not break the Task-5/registry reattach or the double-spawn reservation from the cook feature. The queue is per attach; on reattach the session already exists so input writes directly.
- [ ] Step 3: verify (typecheck + a ws test: input arriving before the session spawns is flushed after the first onData, in order; input after readiness writes directly). Commit: `fix(cook): buffer terminal input until the cook session is ready`.

## Self-review notes

- Coverage: 6 spec items across 8 tasks (T3-T5 split the remix item). D1/D3/D5/D6 rulings applied.
- Risk: T2 (per-beat layout) and T7 (hooks-off live test) are the two with real uncertainty. T2 reshapes a stored JSON column and the frame-pass subprocess contract; T7 must be verified live, not guessed, and can STOP if no source scope works.
- T4/T5 depend on T1, T2, T3 (they consume the per-beat transcript, per-beat layout, and chosen variant). Keep the build order.
- No fabrication anywhere: absent per-beat transcript / layout / hook render as placeholders, and the frame-pass guard rejects a value with no source frame.
