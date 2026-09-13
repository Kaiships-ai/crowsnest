# feed completeness

Use this rubric when scoring Completeness for the `feed` surface: the ranked outlier feed
that is the app's landing page, plus its filters, saved views, preview, and the video
detail actions.

## Category scope

- Ranked list: a server-read page of outlier cards, ranked by outlier score, with
  follower-band counts.
- Filters and URL state: the filter bar, slice, sort, grid or list, and limit all carried
  in the URL, so a slice is a link.
- Saved views: named filter sets plus the two seeded built-ins.
- Empty and error states: the four empty states the page can show (its only failure
  surface, since the page has no server action).
- Preview and detail: the quick preview sheet over the feed, and the video detail page
  with keep-this-post and save-to-vault actions.
- Staleness: the feed still reads with the sidecar, proxy, or Graph token down; only new
  video arrival is affected.

## Completeness questions

- Does the feed rank outliers by score and surface the score and follower-band counts as
  the primary signal?
- Is every view control (filters, sort, slice, grid or list, limit) carried in the URL so
  a slice is shareable and back or forward walks slices?
- Are all documented empty states present and correct, given the page has no other failure
  surface?
- Do saved views work, including the two seeded built-ins?
- Does the quick preview sheet and the video detail page (keep, save to vault) work end to
  end?
- Does the feed still render correctly in restricted states (sidecar, proxy, or Graph
  down), showing stale rather than failing?
- Is a single shared definition of what counts as a filter used by both server and client
  so they cannot disagree?

## Evidence

- Workflow: `feed/01-concept-brief.md`, `feed/03-feature-description.md`.
- Known gaps: `feed/05-backlog-to-enhance.md`.
- Coverage: `feed/04-test-cases.md`, vitest for the filter definitions, browse journeys,
  `scripts/e2e-coverage.sh`.
