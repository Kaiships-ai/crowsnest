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

Commit: (pending)
