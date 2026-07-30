# Wave 2, screens against real contracts

Every query and action you need now exists and is committed. Wave 1 is closed:
775 tests green, tree clean.

## The rule that got us here

No fabricated data. Not in a component, not in a fixture that ships, not as a
placeholder you mean to replace. A value the app does not have renders as a
dash, never a zero. A capability the app does not have does not appear in the
interface at all.

Ten controls that broke this shipped once already and were removed this morning
in commit 9b5f9af. Do not add an eleventh.

## Read before you start

- `docs/product/V1-BRIEF.md`, what V1 means.
- `docs/product/v1-scope.md` section 2, the acceptance criteria for your screen.
  These are checkable, and a tester will run them.
- Your prototype slice under the session scratchpad `proto/` directory.
- The query and action signatures you are building against. Read the actual
  file, not the contract doc, because the contract doc drifted in places and the
  code is what runs.

## What landed in Wave 1 that you should use

- `src/server/settings/` reads every configurable value. Never hardcode a number
  that has a setting. `getSetting("scoreMinUsablePosts")` is the fix for the
  hardcoded 5 in the channel detail page.
- `getFailureStrip()` in `queries/failure-surface.ts` gives eight failure kinds
  with the facts that survived a partial run.
- `getChannelMedianBasis()` in `queries/channels.ts` gives the sample behind a
  score, its size, its span, and the window that produced it.
- `queries/saved-posts.ts` and `queries/planned-posts.ts`.
- `getRemixRunLog()` in `queries/remix-runs.ts`.

## Things that are true and must stay visible

- Removed posts reach the screens carrying `deleted: true`. Show the marker.
  `videoCount` counts live posts only and `removedCount` sits beside it.
- Own channel figures carry their sample size. Every one.
- The frame pass has no vision model, so `runFramePassAction` refuses with
  `FRAME_NO_VISION_MODEL`. Layout reads as not yet analyzed for every video.
  That is correct. Design that state properly rather than hiding the section.
- There is no Graph token on this machine, so own channel insights return a
  not connected result. Design that state properly too. It is what Kai sees.

## Locked

Dark only. The score is the hero on any card that has one. Follower band is a
first class control in the feed, never behind a menu. Amber means one thing,
this beat its channel, allowed on the score and on exactly one primary action
per screen. Every number mono and tabular. Radius 0 except buttons.

## Rules

- Rendering layer only. No schema changes, no new server actions, no edits under
  `src/server` beyond a string literal that is provably false.
- Do not edit `src/app/globals.css`, `src/app/layout.tsx`, or
  `src/components/ui/button.tsx`. Shared and settled.
- Stay inside your file list. Another agent owns the rest.
- Reuse the shadcn primitives in `src/components/ui`.
- Do not run `git commit`. The lead commits.

## Verify before reporting

`npx tsc --noEmit` with no new errors, `npx eslint` clean on your files, and
`npx vitest run` still at 775 or better. Update a test assertion only where it
checks a literal string you changed.

State plainly what you could not verify and why. "Blocked, no Graph token" is a
useful report. "Looks fine" is not.
