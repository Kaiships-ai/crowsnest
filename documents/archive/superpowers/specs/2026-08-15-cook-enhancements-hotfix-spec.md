# Cook enhancements hotfix spec

Status: draft. Prototype approved by Kai (cook-enhancements-prototype.html). This spec grounds the prototype in the real code and surfaces the corrections and decisions the prototype could not see.

## Goal

Raise cook quality and fix the two live cook bugs from the smoke. Six items:
1. Beats carry the verbatim transcript, not just a summary.
2. Layout goes per beat, synced to the beat timecodes.
3. The remix flow finishes, and Create Prompt reads the remix, not the source video.
4. My channel calendar detail is a side panel, not a bottom block.
5. Cook hooks-off actually suppresses the user and project SessionStart hooks.
6. Cook survives the auto-injected command (no lost keystrokes on Cook).

Build order groups these into UI-quality (1, 2, 3, 4) and cook-bugs (5, 6). Items 1 and 2 feed 3, so build 1 and 2 first.

## Two corrections to the prototype

The prototype (approved for its concept and UX) understated two items. The design stands; the cost is higher than drawn.

- Enhancement 1 is NOT a free transcript slice. `transcripts` (schema.ts:184-191) stores a flat `text` blob with no per-segment timecodes. Both providers produce segment times (whisper `offsets.to` at whispercpp.ts:55, Groq `verbose_json` at groq.ts:37) but the parsers discard them. Beats (`structureSegments`, schema.ts:196) already carry `startSec`/`endSec`, but there is no time-aligned transcript to slice against.
- Enhancement 3 does not connect the way the prototype implied. Create Prompt runs `buildVideoPrompt(sourceVideoId)` (source analysis only). brief.md is keyed off the planned post (writeBrief reads `getStudioBrief(postId)`), and the planned post has no hook/outline columns. The remix session (which holds `chosenHook`, `outline`, `variants`) never reaches the cook today; the link is two-hop (save script, optionally add-to-plan, studio spawns for the post).

## Enhancement 1: beats carry the transcript

Grounded: analyze (`getOrCreateAnalysis`, analyze.ts:66) makes one LLM call (analyze.ts:98) that already reads the full transcript and emits `structureSegments: { label, startSec, endSec, note }[]` (schema.ts:196, VideoAnalysisSchema at llm/schemas.ts:13). The Hook and structure tab maps those (video-detail.tsx:186).

Decision D1 (recommend path b): how does each beat get its verbatim transcript?
- Path a (accurate, bigger): persist time-aligned transcript segments (new column on `transcripts`, keep provider segment times, stop discarding them), re-transcribe existing videos to backfill, slice each beat's `[startSec, endSec]` window. Accurate to the audio, but a transcript-pipeline change plus re-transcription of the cached rows.
- Path b (recommended): add a `transcript` field to each `structureSegment` in the analyze schema, and have the analyze LLM fill it with the verbatim words spoken in that beat (it already has the full transcript in the prompt). Change: `VideoLayout`... no, `VideoAnalysisSchema.structureSegments` gains `transcript: string`, `ANALYZE_SYSTEM` (analyze-prompt.ts:6) instructs the model to include the exact words per segment, `structureSegments` column type widens (schema.ts:196), and analyzed videos re-run analyze to backfill. No transcript-pipeline change. The tradeoff: the model assigns the words to beats rather than a hard time-slice, so alignment is model-judged, not exact. For a cook brief that is acceptable.

UI: video-detail.tsx HookStructureTab renders the new `segment.transcript` above the existing `segment.note`, matching the prototype (transcript block, then summary block).

## Enhancement 2: per-beat layout

Grounded: the frame pass (`runFramePass`, frame-pass-runner.ts:115) extracts sampled frames (watch.py, dynamic count) and a read-only Claude subprocess (`buildLayoutPrompt`, frame-pass-prompt.ts:17) emits one flat `VideoLayout` (llm/schemas.ts:48: onScreenText, textPosition, cutRhythm, framing, each `{ value, fromFramesSec }`), persisted on `videoAnalyses.layout` (schema.ts:214). The Layout tab renders the 4 flat fields (layout-section.tsx:123).

Change to per-beat:
- The stored shape moves from one `VideoLayout` to a per-beat collection keyed to the beat timecodes: an array of `{ startSec, endSec, label, onScreenText, animation, demoCursor, toolDemo, textPosition, voicePace }` (the prototype's 6 columns plus the beat key). New fields (animation, demoCursor, toolDemo, voicePace) that the flat shape lacked.
- `buildLayoutPrompt` changes to receive the beats (`structureSegments`) and the sampled frames (each with `timestampSeconds`), and to emit one layout row per beat, assigning frames to the beat window. The anti-fabrication guard (frame-pass.ts:83, empty `fromFramesSec` rejects a value) carries forward per beat.
- Persist (frame-pass.ts persistFramePass) and the schema `layout` column type change. Re-running the frame pass on a video produces the new shape; old flat layouts either migrate or show a "re-run frame pass" prompt.
- Layout tab (layout-section.tsx) renders the per-beat table from the prototype.

Cost note: this needs a re-run of the frame pass per video (a Claude subprocess reading frames), so it is not free for the existing library; it applies going forward and on re-run.

## Enhancement 3: remix finishes, Create Prompt reads the remix

Grounded: stages are `prompt|research|hook|style|script` (remix.ts:11, stepper.tsx STAGES); no finish stage. The session (`remix_sessions`, schema.ts:296) stores `chosenHook`, `styleVaultItemId`, `outline` (beats JSON), `variants` (string[]), but NOT which variant was chosen. Create Prompt uses `buildVideoPrompt(sourceVideoId)` (export.ts:83, source analysis only). saveScript copies the active variant into a `scripts` row.

Three parts:
1. A finish step. Add `"finish"` to `RemixStage` and STAGES (stepper.tsx), render a finish view in remix-studio.tsx. The finish action confirms the pick and routes to the studio for the linked planned post. Because the remix-to-cook bridge is the planned post (which carries `scriptId` and `remixSessionId`), finishing should ensure a planned post exists (reuse `createPlannedPostAction`) and open its studio.
2. Track the chosen variant. Add a `chosenVariantIndex` (or persist the chosen variant text) to `remix_sessions`, set when the user picks a variant / saves. Needed so the prompt and the brief use the variant the user chose.
3. A remix-scoped prompt builder. A new `buildRemixPrompt(sessionId)` (or extend buildScriptPrompt) that reads the remix SESSION: source outlier (from the source video), the `chosenHook`, the beats with their new per-beat transcript (enhancement 1) and per-beat layout (enhancement 2), and the chosen script variant. Create Prompt at the Script step calls this instead of `buildVideoPrompt(sourceVideoId)`.

Decision D3 (load-bearing): how does the remix's hook/beats/layout reach the cook's brief.md? Today writeBrief reads the planned post (`getStudioBrief`), which lacks hook/outline. Options:
- Extend writeBrief to follow the planned post's `remixSessionId` back to the remix session and include chosenHook + the enriched beats + layout. Keeps brief.md the single cook input; the plan already carries `remixSessionId`.
- Or add hook/outline columns to the planned post and populate on add-to-plan.
Recommend the first (follow remixSessionId in writeBrief), since the link column already exists and it keeps the cook input in one writer.

## Enhancement 4: calendar side panel

Grounded: the detail is an appended block (mine-calendar.tsx:296-388), a sibling of the grid, gated on `selectedCell`. There is an existing `src/components/ui/sheet.tsx` (Radix slide-in) and `PlanDialog` already uses the Dialog pattern.

Change: move the detail block (mine-calendar.tsx:296-388) into a `Sheet` opened off `selectedKey` (side="right"), so it slides in beside the grid, keeps the selected cell's ring (the `ring-1` at :242 stays), and closes on Escape / click-outside (Sheet gives both). Under 640px the Sheet becomes a bottom sheet (Sheet supports side="bottom" via a breakpoint, or the app's Sheet default). The fields and 5 actions are unchanged; only the container changes. This is the smallest item, mostly a wrap.

Follow the emil-design-eng notes: slide from the right, ~220ms ease-out, transform + opacity, the ring stays as the spatial anchor, action buttons get `:active` scale feedback.

## Enhancement 5 (cook bug): hooks-off actually works

Grounded: the cook spawns `--settings '{"hooks":{"SessionStart":[]}}'` (harness-profile.ts:28). Confirmed live in the smoke: a user-level SessionStart hook (load_vault_context.py) still fired. The CLI docs say `--settings` loads ADDITIONAL settings (a merge), so it cannot delete inherited hooks. `--setting-sources <user,project,local>` is a whitelist of sources to load.

Fix direction: pass `--setting-sources` to exclude the sources that carry SessionStart hooks. The leak has two sources: user (`~/.claude/settings.json`) and, because the sandbox cwd walks up into the Crowsnest repo, the project (`.claude/settings.json`, the humanizer hooks). So the cook needs to load neither user nor Crowsnest-project SessionStart hooks.

Decision D5 (needs live verification, this is the one item that must be tested, not guessed): which `--setting-sources` value gives the cook what it needs without the hooks? Candidates: `local` only, or a value that keeps what the cook relies on. The tradeoff is that scoping out a source drops ALL of its settings, not just hooks. The cook passes model, permission-mode, and plugin-dir explicitly, and Claude Max auth is OAuth/keychain (not settings.json), so dropping user/project settings.json may be safe. The build must spawn a real cook and confirm no ADHD / caveman / superpowers / humanizer / last30days / load_vault_context banner appears, and that the cook still runs, resolves ksa:cooking, and authenticates. `--bare` is disqualified (it disables plugin sync, which the cook needs for --plugin-dir).

## Enhancement 6 (cook bug): no lost keystrokes on Cook

Grounded: cook() injects `/ksa:cooking\r` immediately on click (studio-panel.tsx:101). `TerminalPane.send` only writes if `ws.readyState === OPEN` (terminal-pane.tsx:55), and the server `session?.write` drops input if the pty session is not yet spawned (ws.ts:170). No buffer, no readiness gate. The `run:"running"` frame (ws.ts:262, sent after spawn) is the closest boot signal but is only used to start the elapsed clock.

Decision D6 (recommend server-side buffer): 
- Server-side buffer (recommended): in ws.ts, when input arrives before the session exists (or before the cook is spawned through the queue), queue it and flush into the pty once the session is created. This fixes it for any early input, not just the Cook button, and needs no client readiness handshake. Even then, the claude REPL may not be ready to accept a slash command the instant the pty spawns, so the flush should wait for the first output from the session (the REPL prompt) before writing the queued command.
- Client gate (alternative): cook() waits for the `run:"running"` frame plus the first `output` frame before injecting. Simpler client change, but only fixes the Cook button, not general early input.

## Acceptance criteria

1. A video's Hook and structure tab shows, per beat, the verbatim transcript for that beat plus the summary. Re-analyzing a video populates the transcript per beat.
2. The Layout tab shows one row per beat, synced to the beat timecodes, with on-screen text, animation, demo cursor, tool demo, text position, voice pace. Re-running the frame pass produces it.
3. The remix flow has a finish step that opens the studio for the linked planned post. Create Prompt at the Script step produces a prompt built from the remix session (chosen hook, enriched beats, per-beat layout, chosen variant), not the source video's raw analysis. The chosen variant is tracked.
4. Clicking a planned post on the calendar opens a right-side panel (bottom sheet under 640px) that keeps the grid visible and the cell's ring; Escape and click-outside close it.
5. A real cook shows no hook banners in its terminal frames and still runs, resolves ksa:cooking, and authenticates.
6. Clicking Cook reliably starts the cook; the injected command is never lost to a still-booting session.

## Files touched (anticipated)

- Enh 1: src/server/llm/schemas.ts, src/server/services/prompts/analyze-prompt.ts, src/server/services/analyze.ts, src/server/db/schema.ts (structureSegments type), src/components/video/video-detail.tsx.
- Enh 2: src/server/llm/schemas.ts (VideoLayout shape), src/server/services/frame-pass-prompt.ts, src/server/services/frame-pass.ts, src/server/db/schema.ts (layout column), src/components/video/layout-section.tsx.
- Enh 3: src/server/services/remix.ts, src/components/remix/stepper.tsx, src/components/remix/remix-studio.tsx, src/components/remix/stage-script.tsx, src/server/services/export.ts, src/server/db/schema.ts (chosen variant), src/server/studio/write-brief.ts, planned-post-actions.ts.
- Enh 4: src/components/mine/mine-calendar.tsx (reuse src/components/ui/sheet.tsx).
- Enh 5: src/server/terminal/harness-profile.ts.
- Enh 6: src/server/terminal/ws.ts (or studio-panel.tsx + terminal-pane.tsx).

## Decisions to settle (my recommendations in each)

- D1 beats transcript: path b (analyze LLM emits per-beat transcript). Recommend b.
- D3 remix brief: writeBrief follows the planned post's remixSessionId to include hook/beats/layout. Recommend this over new plan columns.
- D5 hooks-off: pick the --setting-sources value by live test. Must verify, not guess.
- D6 auto-inject: server-side input buffer flushed on first session output. Recommend server-side.
