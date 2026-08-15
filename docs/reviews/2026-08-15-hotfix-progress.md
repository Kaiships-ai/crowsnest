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

Commit: 81e29c4

## Task 4: remix-scoped Create Prompt builder

`buildVideoPrompt` answers "describe this outlier", which is right on the video detail
screen and wrong at the end of a remix: by the Script stage the user has chosen a hook and
a variant that the source analysis knows nothing about.

Changed:

- `services/export.ts`: `buildRemixPrompt(sessionId)` with sections Source outlier, Chosen
  hook, Beats (per-beat transcript above the summary), Layout per beat, Script (the chosen
  variant), Target length. Plus two helpers, `beatsSection` and `layoutPerBeatSection`.
- `services/remix.ts`: exports `getRemixSession(id)`, which returns null rather than
  throwing on a missing id, so a builder asked about a dead session returns null instead
  of blowing up an action.
- `actions/export-actions.ts`: `buildRemixPromptAction`.
- `stage-script.tsx`: Create Prompt calls `buildRemixPromptAction(session.id)`.
  `buildVideoPromptAction` stays exactly where it was on the video detail screen, which is
  the surface it is correct for.

Three anti-fabrication rules carried into the prompt text:

- No fallback to `variants[0]`. An unpicked session prints "(no variant picked; N
  written.)" and none of the variant text, because presenting a script the user never
  chose under the heading "Script" is a fabrication with a confident label on it.
- A layout value citing no source frame renders as a dash, the same rule the UI applies.
- No full source transcript. The per-beat quotes already carry the words, split the way
  the remix will be shot; dumping the raw blob again would bury the chosen script under
  the source's own words. There is a test asserting the blob is absent.

Tests: an export `buildRemixPrompt` describe with six cases, including the
transcript-blob-absent case, the unbacked-layout-value case, and the missing hook and
missing pick case.

Verification:

- `npm run typecheck`: clean.
- `npx vitest run src/server/services/export.test.ts`: 13 passed.
- Whole `src/` suite: 1509 passed, 1 failed (the pre-existing outlier-calc median).

Commit: 68d494f

## Task 5: brief.md follows remixSessionId

D3 as ruled: `writeBrief` follows the planned post's `remixSessionId` rather than adding
hook and outline columns to the plan. The link column already existed and was already
populated (stage-script's add-to-plan, and now finishRemix); nothing read it until now.

Changed:

- `queries/studio.ts`: `getStudioBrief` gains a `remix` field, `{ session, sourceAnalysis }`
  or null. The analysis is loaded off the SESSION'S `sourceVideoId`, not reused from the
  plan's `video`. In the normal flow those are the same row, but a plan can be hand
  edited, and if they diverge the hook and beats must describe the video the remix was
  actually built from rather than attributing one video's beats to another remix's hook.
- `studio/write-brief.ts`: new `## Hook` and `## Beats` sections, emitted only when the
  plan came from a remix. A hand-made plan gets neither heading: "## Hook" over "(none)"
  would imply a hook was chosen and then lost.
- The layout section is renamed `## Frame-pass layout` to `## Layout per beat` and now
  prefers the remix's own source analysis, so it describes the same video as the Beats
  section above it. Checked `plugins/ksa/commands/cooking.md` first: the cook reads the
  brief generically and only looks up "video kind" by name, so the rename is safe.

Beat transcripts print three ways and never invent: the quote, "(no words spoken in this
beat)" for an empty string, "(not captured; re-analyze the source video)" when the field
is absent.

Tests: `studio.test.ts` gains the follow-the-link case (asserting it reads the session's
own analysis) and the null case. `write-brief.test.ts` gains a remix-present case
(hook, beat transcript, beat summary, layout row), a remix-absent case asserting neither
heading appears, and a not-captured-transcript case.

One thing worth knowing: the not-a-heading assertion is line-anchored, because the layout
section's per-beat `### Hook (0s to 3s)` contains `## Hook` as a substring. A plain
`not.toContain` there passes for the wrong reason.

Verification:

- `npm run typecheck`: clean.
- `npx vitest run` on write-brief (10 passed) and studio queries (7 passed).
- Whole `src/` suite: 1514 passed, 1 failed (the pre-existing outlier-calc median).

Commit: f8cb6db

## Task 6: calendar detail opens as a side panel

Changed, all in `components/mine/mine-calendar.tsx`:

- The detail block (previously a sibling appended under the grid) now lives inside the
  existing `Sheet` from `components/ui/sheet.tsx`, opened off `selectedCell !== null`,
  closed by `onOpenChange`. The hand-rolled close button is gone: `SheetContent` already
  ships one, and Escape and click-outside come from the Sheet.
- The selected cell's `ring-1` is untouched, so it stays the spatial anchor for where the
  panel came from.
- `useNarrowViewport()` subscribes to `(max-width: 639px)` and `detailPanelSide()` maps it
  to `right` or `bottom`. Subscribed rather than read once (unlike the reduced-motion
  read in kanban-board.tsx) because this decides layout, not a flourish, and a rotate or
  a resize should move the panel. It starts false so the server render and the first
  client render agree.
- Motion: the Sheet's own transition is already transform plus opacity over 200ms. Added
  `motion-reduce:` overrides that pin the translate to 0, so reduced motion collapses the
  slide to a fade instead of disabling the transition entirely.
- The three text actions in the panel got `active:translate-y-px`. The `Button` component
  already had `active:not-aria-[haspopup]:translate-y-px`; these are plain `<button>`
  elements styled as links and had nothing.

Correction worth recording: `sync-progress-panel.test.tsx` says this repo has no DOM test
environment and that neither jsdom nor testing-library is installed. That is out of date.
Both `jsdom` and `@testing-library/react` are in devDependencies, and `logs-view.test.tsx`
already uses them via a per-file `@vitest-environment jsdom` docblock. So the new
`mine-calendar.test.tsx` is a real DOM test, not a static-markup approximation.

That matters, because the first version of this test was a static-markup one asserting the
detail text was absent from the inline output. It passed, and it was worthless: with
nothing selected the detail never renders anyway, so it would have passed against the old
code too, and against code with the feature deleted. It was replaced with three tests that
actually exercise the change: closed until a cell is selected, then the detail rendering
inside `[data-slot='sheet-content']` with the grid still on screen, then Escape closing
it. All three fail on the old inline block.

`@testing-library/user-event` is not installed, so the clicks and the Escape key go
through `fireEvent`.

Verification:

- `npm run typecheck`: clean.
- `npx vitest run src/components/mine/mine-calendar.test.tsx`: 6 passed.
- `npm run lint`: the 14 errors are all in the vendored `plugins/ksa` tree and predate
  this branch. Cleared one warning this branch introduced (an unused `VideoAnalysis`
  import left in analyze.ts by T1).
- Whole `src/` suite: 1520 passed, 1 failed (the pre-existing outlier-calc median).

Commit: b094c13

## Task 7: cook hooks-off actually suppresses SessionStart hooks

This was a live investigation, run from a real sandbox-style cwd
(`data/workspace/videos/hooks-probe`, deleted afterwards) against
`/Users/kienbeovl/.local/bin/claude` with the real `plugins/ksa`.

### The baseline, reproduced

With today's flags (`--settings '{"hooks":{"SessionStart":[]}}'`, no source scoping), a
`-p` session asked to quote any line in its own context mentioning MODE ACTIVE, vault
context, ADHD, caveman, superpowers, humanizer, last30days, or second-brain answered with,
among others:

```
SessionStart:startup hook success: ADHD MODE ACTIVE (always-on). The ruleset below applies
to every response.
```
```
You have superpowers.
```
```
The `humanizer@humanizer` plugin skill, based on Wikipedia "Signs of AI writing").
```

So the leak is real and `--settings` is confirmed additive: an empty SessionStart array
merged in cannot delete an inherited one.

### Candidates tested

The CLI rejects anything outside the three named sources: `--setting-sources none` errors
with "Invalid setting source: none. Valid options are: user, project, local". An empty
string is accepted.

| value | hook banners | notes |
| --- | --- | --- |
| (flag omitted, today) | ADHD, superpowers, humanizer all present | the bug |
| `local` | none | still enables the humanizer and ponytail plugins via settings.local.json |
| `project` | none | loads the repo's own hooks, which the cook has no use for |
| `project,local` | none | both of the above |
| `""` | none | loads no settings file at all |

### The winner: `--setting-sources ""`

Verified live, all three requirements, under that exact value:

1. No hook banner. The same probe came back with no SessionStart line at all.
2. Still authenticates. The session answered, and there is no `ANTHROPIC_API_KEY` in the
   environment, so that was Claude Max OAuth through the keychain. Dropping settings.json
   does not touch auth.
3. Still resolves the plugin. Asked to list every available command whose name contains
   "ksa", the session printed `ksa:cooking`, `ksa:serve`, and the seven baoyu commands.

`--bare` stays disqualified: it kills plugin sync, which the cook needs, and restricts auth
to an API key.

Why the empty value over `project` or `local`, which also suppressed the banner: those
load a settings file the cook has no use for and that can be changed under it later.
Loading nothing is the narrower and more stable promise.

Changed in `server/terminal/harness-profile.ts`: `settingsJson` is replaced by
`settingSources`, `--settings` is dropped entirely (with `""` there is nothing left to
override, so keeping it would be a flag that reads like it does something), and
`COOK_SETTING_SOURCES = ""` carries the finding plus the live evidence in its doc comment.

One trap worth naming: `buildHarnessArgs` emits the flag on `!== undefined`, not on
truthiness. `""` is falsy, and a truthiness check would silently drop the flag and undo
the entire fix while every other test stayed green. There is a test pinning that exact
case.

### Two things the probe found that are NOT hook leaks

The cook's context still carries the auto-memory index (`MEMORY.md`) and the gitStatus
block. Those come from auto-memory and CLAUDE.md discovery, not from settings hooks, so
`--setting-sources` does not touch them and acceptance criterion 5 (no hook banners) is
still met. Flagging them because they are Kai's personal notes riding into a cook's
context, which may or may not be wanted. Not fixed here; not in this plan's scope.

Also worth knowing: under `--setting-sources project` the repo's `humanizer-doc-check.sh`
PreToolUse hook did NOT block a markdown write containing an em dash from the sandbox cwd.
Tested directly, expecting it to fire. So that hook was never the risk to the cook it
looked like.

Verification:

- `npm run typecheck`: clean.
- `npx vitest run src/server/terminal/`: 68 passed. `harness-profile.test.ts` rewritten
  for the new flag; `session.test.ts` had two fixtures and one exact-argv assertion on the
  old flag.

Commit: 035277b

## Task 8: no lost keystrokes on Cook

D6 as ruled: a server-side buffer flushed on the session's first output.

Two windows used to swallow input, and `entry.session?.write(data)` dropped both on the
floor. The pty may not exist yet, because the spawn can sit behind other cooks at the
concurrency limit. And once it does exist, the claude REPL has not printed its prompt yet
and swallows anything written before it. The Cook button injects `/ksa:cooking\r` the
instant it is clicked, which lands in exactly those windows.

Changed:

- `session-registry.ts`: `CookEntry` gains `inputQueue`, `inputReady`, `inputFlush`, plus
  `writeCookInput(entry, data)` and `flushCookInput(entry)`. The queue is bounded at
  `MAX_QUEUED_INPUT = 256` frames and logs on overflow, so a client cannot make the
  server hold arbitrary memory by typing at a cook that never spawns, and hitting the
  ceiling is visible rather than another silent drop.
- `ws.ts`: both message handlers route input through `writeCookInput`. The fallback timer
  (`INPUT_FLUSH_FALLBACK_MS = 8_000`) is armed right after the spawn, the flush runs on
  the session's first `onData`, and the timer is cleared on the abort path and in the
  synchronous setup-failure catch alongside the watchdog and the waiting check.

Deviation from the plan, deliberate: the plan said "the queue is per attach". It is per
ENTRY instead. The plan's own note on the reattach branch says a reattach can land on a
placeholder whose spawn has not run yet, and a per-attach queue would leave that socket's
input dropped, which is the same bug one layer over. Putting it on the entry fixes both
paths with one mechanism. There is a test for the placeholder-reattach case specifically.

Resize is NOT queued. A stale terminal size for a pty nobody is watching yet is worth
nothing, and the client sends a fresh resize on every dimension change.

Invariant worth naming: `inputReady` is never set true while `session` is null.
`flushCookInput` returns early in that case rather than flagging ready, because the write
path takes its direct branch on `session && inputReady`, and a ready flag with no session
would put the drop back exactly where it was.

The shipped cook feature is intact: the render-watch capture, the per-post registry, the
reattach branch, the double-spawn reservation, and the gate-aware watchdog are all
unchanged. The only edits to their code paths are the three timer-clear additions.

Tests: `session-registry.test.ts` gains 11 unit tests over the queue (queued before spawn,
queued before first output, direct after ready, bounded, drained in order, idempotent
flush, and the no-session-means-not-ready invariant). `ws.test.ts` gains four integration
tests: input before first output is held then written in order, later input goes direct,
the fallback timer flushes a silently-booting cook, and a reattach onto a still-queued
placeholder holds its input. Three existing timer-count assertions moved from 2 to 3, and
the existing "relays an input message" test now emits an onData frame first, since that
is what makes the cook ready.

`ws.test.ts` mocks the registry with a fake Map. `writeCookInput` and `flushCookInput`
come from `vi.importActual` rather than being stubbed: they are logic, not storage, and
stubbing them would leave those tests unable to say anything about whether early input
actually survives.

Verification:

- `npm run typecheck`: clean.
- `npx vitest run src/server/terminal/`: 81 passed.
- Whole suite: 1542 passed, 1 failed (the pre-existing outlier-calc median).

Commit: ac665e4

## Final-review cleanup

Four items off the opus final review, one commit.

1. `write-brief.ts` `formatLayoutField` now returns a dash when `value` is non-null but
   `fromFramesSec` is empty, matching `export.ts`'s `layoutPerBeatSection` and
   `layout-section.tsx`'s `fieldValue`. `persistFramePass` already refuses to store that
   combination, so it is unreachable for validated data. Written defensively anyway
   because of the three readers this is the one that feeds a cook: the other two put an
   uncited value on a screen a human is reading, this one puts it in a brief a model
   treats as ground truth.
2. `frame-pass.ts` doc comment said "the four Layout fields come back as a VideoLayout".
   Reworded to the per-beat shape, and it now says the guard runs per field per beat.
3. `schema.ts` layout column doc comment said "there is no frame pass wired up yet" and
   "a null layout renders as four dashes". Both stale. Reworded to name the real runner,
   the per-beat shape, and the two shapes the column can hold.
4. `vitest.config.ts` excludes `plugins/**`. The vendored
   `plugins/ksa/skills/baoyu-image-gen` suite is written for a different runner; under
   vitest all 14 files failed with "No test suite found". Fourteen permanently red files
   say nothing about this repo and would hide a real regression in the noise. `tsconfig`
   already excluded `plugins` for the same reason.

Verification:

- `npm run typecheck`: clean.
- `npx vitest run`: 115 files, 1542 passed, 1 failed. The plugin noise is gone (was 129
  files with 15 red). The single remaining failure is `outlier-calc.test.ts`, which was
  already red on a clean checkout of this branch before any of this work started.
