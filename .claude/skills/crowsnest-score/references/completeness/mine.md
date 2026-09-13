# mine completeness

Use this rubric when scoring Completeness for the `mine` surface: the my-channel page for
the user's own Instagram account, with Graph-measured metrics and the month planner. The
scheduled-publish pipeline itself belongs to `publish`.

## Category scope

- Own channel: exactly one channel flagged as the user's own, set and cleared by their own
  actions.
- Graph metrics: followers, reach, saves, shares, median reach, and posts measured through
  the official Graph API, with a progress bar toward a usable median and a reach-by-post
  strip, kept in a separate table set from tracked channels.
- Tab strip: month planner calendar, posts list, and weekday metrics chart.
- Planner: a month grid of planned and published days, the plan dialog to create or edit a
  planned post, and the publish dialog to attach a video and publish now or schedule.
- Planned-post state: draft, scheduled, publishing, published, failed, with missed derived
  on read.
- Independence: the planner renders with no Graph token; the metrics band gates on a real
  measurement.

## Completeness questions

- Can the user set and see which channel is their own, and are Graph metrics measured and
  shown with the progress-to-median indicator?
- Are own-channel metrics kept in a separate table set from tracked channels, never mixed
  with tracked view counts?
- Do all three tabs (planner, posts, metrics chart) work?
- Can the user create and edit a planned post, and open the publish dialog to attach a
  video and publish now or schedule?
- Is missed derived on read so a reschedule never leaves a stale missed cell?
- Does the planner render with no Graph token while the metrics band correctly gates on a
  real measurement?
- Are the documented gaps (lossy delete undo, no UI control to clear the own channel)
  accounted for rather than silently broken?

## Evidence

- Workflow: `mine/01-concept-brief.md`, `mine/03-feature-description.md`; the publish
  pipeline in `publish/`.
- Known gaps: `mine/05-backlog-to-enhance.md`; the `01` status line flags the lossy delete
  undo and the missing clear-own-channel control.
- Coverage: `mine/04-test-cases.md`, vitest, browse journeys, `scripts/e2e-coverage.sh`.
