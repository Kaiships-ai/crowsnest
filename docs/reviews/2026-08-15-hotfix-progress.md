# Cook enhancements hotfix: progress log

Branch: feat/cook-enhancements-hotfix
Plan: docs/superpowers/plans/2026-08-15-cook-enhancements-hotfix.md

## Pre-existing red before any of this work

Two suites were already failing on a clean tree (verified with `git stash`, then
re-running):

- `src/server/services/outlier-calc.test.ts`, 1 test: a median expectation of 300 that
  computes 350. Untouched by this branch.
- 14 files under `plugins/ksa/skills/baoyu-image-gen/scripts/`: "No test suite found".
  Vendored plugin scripts that vitest picks up but cannot run.

Everything else was green: 113 files, 1489 tests. `npm run typecheck` was clean.

## Task 1: beats carry a verbatim per-beat transcript

Changed:

- `src/server/llm/schemas.ts`: pulled the beat out into `StructureSegmentSchema` and
  added `transcript: z.string()` (required on the write path, so no new analysis can
  land without one). Added `StoredStructureSegment` (transcript optional) and
  `StoredAnalysisFields` for the read path, because rows written before this field
  exists have no transcript and nothing backfills them.
- `src/server/db/schema.ts`: `structureSegments` `$type` is now `StoredStructureSegment[]`.
- `src/server/services/prompts/analyze-prompt.ts`: `ANALYZE_SYSTEM` now asks for the
  exact words spoken in each beat, copied verbatim, split so that reading the segments
  in order reproduces the transcript it was given, empty string for a silent beat.
- Type widening so the stored (tolerant) shape flows to readers:
  `services/analyze.ts` (`StoredVideoAnalysis`, `getOrCreateAnalysis` return),
  `services/remix.ts`, `services/export.ts`, `components/vault/save-to-vault-dialog.tsx`.
- `src/components/video/video-detail.tsx`: each beat renders a "transcript" block above
  a "summary" block. Three states, no invented words: the quote when present, "(no
  words spoken in this beat)" for an empty string, "(re-analyze to capture the
  transcript per beat)" when the field is absent.

One thing the plan assumed that turned out to be false: it said "the Re-analyze
affordance already exists, confirm its path". It does not. `getOrCreateAnalysis` is
cache-first and `analyzeVideoAction` returns the cached row, and the Analyze button only
renders when there is no analysis at all. Without a re-run path, every already-analyzed
video would show the placeholder forever and acceptance criterion 1 ("Re-analyzing a
video populates the transcript per beat") would be unreachable from the UI. So T1 also
adds:

- `getOrCreateAnalysis(videoId, { force: true })`, which regenerates and UPDATEs the
  text-model columns only. The Layout columns (layout, framesSampled, frameModel,
  framePassAt, framePassError) are deliberately left alone: they are a separate pass
  with separate provenance, a text re-analysis has seen no frames, and wiping them would
  throw away a real reading.
- `reanalyzeVideoAction` in `server/actions/analyze-actions.ts`.
- A "Re-analyze" ghost button in the Beats header.

Deviation from the prototype, on purpose: the prototype drew the transcript block with a
purple border. This app has no purple; it is monochrome with `--accent` set to a near
black. The block uses the repo's existing quote idiom (`border-l-2 border-border pl-3`,
the same one mine-calendar and graph-connect-panel use) so it reads as part of the app
rather than as a pasted mockup.

Tests: `analyze.test.ts` gains a round-trip assertion for the beat transcript, a forced
re-analysis test that asserts the layout columns survive, and a `VideoAnalysisSchema`
describe block with both a validates case and a rejects-a-beat-with-no-transcript case.

Verification:

- `npm run typecheck`: clean.
- `npx vitest run src/server/services/analyze.test.ts`: 9 passed.
- Also re-ran export, remix, similar, ideas, auto-analyze, write-brief: 76 passed.

Commit: a8600e9

## Task 2: per-beat layout

The stored layout went from one flat object to an array of beat rows.

Shape decision the plan left open ("per-field `{value, fromFramesSec}` or one
`fromFramesSec` per row"): per field. A shared per-row citation would let one field earn
the frames and the other five ride along unbacked, which is the exact failure the guard
exists to stop. The cost is a longer JSON payload from the subprocess, and a truncated
payload is a real observed failure mode on this pass, so the prompt's citation cap is
tightened from "2 to 5" to "1 to 2" per field to keep the output small. Flagged below as
the one thing worth watching on the first live run.

Changed:

- `src/server/llm/schemas.ts`: `BeatLayoutSchema` (startSec, endSec, label plus the six
  readings), `VideoLayoutSchema` is now `z.array(BeatLayoutSchema)`, `BEAT_LAYOUT_FIELDS`
  is the shared field order, `LegacyFlatVideoLayoutSchema` names the old shape,
  `StoredVideoLayout` is the union, and `asBeatLayout` narrows a read to beat rows or
  null.
- `src/server/db/schema.ts`: `layout` column `$type` is `StoredVideoLayout`.
- `frame-pass-prompt.ts`: `buildLayoutPrompt(frames, beats)` lists the beats with their
  windows, tells the model to read each beat only from frames inside that beat's window,
  and prints a filled-in skeleton with one object per beat.
  `parseLayoutResult` now scans for a balanced JSON array (the brace scanner was
  generalized to `balancedCandidates(s, open, close)`) and rejects `[]`.
- `frame-pass.ts`: `persistFramePass` validates per beat row, rejects an empty array and
  a backwards beat window, and the anti-fabrication guard plus the length cap run per
  field per beat with the beat named in the error.
- `frame-pass-runner.ts`: loads the beats off `videoAnalyses.structureSegments` and
  refuses with a new `FRAME_NO_BEATS` code when there are none, before spending an ffmpeg
  run. This is a real behavior change: the frame pass used to be allowed to run before
  the text analysis, and it no longer is. The alternative was letting the frame reader
  invent its own beat boundaries, which would produce a layout that lines up with nothing
  the Hook and structure tab shows.
- Readers updated to the array shape: `components/video/layout-section.tsx` (per-beat
  table, scrolls inside its own container), `components/studio/studio-screen.tsx`
  (per-beat blocks in the Visual direction pane), `server/studio/write-brief.ts` (one
  `###` block per beat), `scripts/frame-pass.ts` (the CLI's summary line).

Old flat rows are not migrated. A flat reading has no beat timecodes and reshaping it
into beats it never described would be fabrication, so those videos render the re-run
prompt with copy that says exactly that.

Tests: `frame-pass-prompt.test.ts` rewritten for the array (beat windows in the prompt,
array parsing, the empty-array rejection, a bracket inside a string value not breaking
the scan). `frame-pass.test.ts` gains a guard test that reaches the second beat row (not
just the head of the array), an empty-array test, a backwards-window test, and a
round-trip test. `frame-pass-runner.test.ts` gains the `FRAME_NO_BEATS` refusal, and
asserts it refuses before calling extractFrames. `layout-section.test.ts` gains an
`asBeatLayout` describe covering all three shapes.

Concern to carry into the first live frame pass: output length. Six readings times N
beats is a bigger payload than the flat four fields were, and truncation is how this pass
failed before. The 1-to-2-timestamp cap and the printed skeleton are the mitigations; if
a live run comes back truncated, the next lever is dropping to a per-row citation.

Verification:

- `npm run typecheck`: clean.
- `npx vitest run` on frame-pass, frame-pass-prompt, frame-pass-runner, frame-pass-job,
  write-brief, layout-section, studio queries: all pass.
- Whole suite: 1503 passed, 1 failed, and the 1 failure is the pre-existing
  outlier-calc median. Same 15 red files as the baseline.

Commit: 8bdc7d7

## Task 3: remix finish stage and chosen-variant tracking

Changed:

- `remix_sessions.chosenVariantIndex integer`, migration `drizzle/0021_rapid_fantastic_four.sql`
  (generated with `npm run db:generate`, applied against a temp DB at
  `data/tmp/hotfix-test.db` and then deleted; `data/crowsnest.db` was never touched).
  Null means "no pick yet", which is a real state: nothing anywhere defaults a missing
  pick to variant 0, because that would show the user a script they never chose and call
  it their pick.
- `RemixStage` and `STAGES` gain `"finish"`.
- `saveScript(id, content, title, variantIndex?)` records the index alongside the script
  row. Saving is the definitive pick.
- `finishRemix(sessionId)` in `services/remix.ts` plus `finishRemixAction`: finds the
  planned post already linked to the session or creates one, sets the stage to "finish",
  and returns the postId. Idempotent, because the finish button is a plain button a user
  can click twice. The plan is created undated: a finish is not a scheduling decision,
  and stamping a date the user did not pick would put a commitment on their calendar.
- `components/remix/stage-finish.tsx`: shows the chosen hook and the chosen variant, each
  falling back to an explicit placeholder rather than a default, then the "Finish and open
  studio" action which links to `/mine/<postId>/studio`.
- `stage-script.tsx`: opening a variant tab persists `chosenVariantIndex`; the stage opens
  on the recorded pick rather than always on variant 1; "Regenerate all" clears the pick
  back to null, since every variant it pointed at was just replaced.
- `remix-studio.tsx`: renders the finish view, the Script stage's Continue now advances to
  it (gated on a variant existing, not on one being picked, so the finish screen is what
  explains a missing pick), and the footer Continue hides on "finish" instead of on
  "script".

Tests: `remix.test.ts` gains index-persisted and index-left-null cases on saveScript, and
a `finishRemix` describe covering the created-plan shape (undated, linked, carries the
script and target length), idempotency, and finishing with no saved script.

Verification:

- `npm run typecheck`: clean.
- `npx vitest run src/server/services/remix.test.ts`: 32 passed.
- Whole `src/` suite: 1503 passed, 1 failed (the pre-existing outlier-calc median).

Commit: (pending)
