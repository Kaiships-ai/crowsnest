# mine: backlog to enhance

Bugs and enhancements for mine. One row per item.

| ID | Title | Severity | Type | Source | Status |
| --- | --- | --- | --- | --- | --- |
| B-04 | A plan edit is up to four separate writes with no rollback, so a mid-sequence failure leaves a partial edit | medium | bug | bug-triage | done |
| B-09 | The calendar delete Undo is lossy, dropping id, remix session, source video, video kind, time, and target length on re-create | medium | bug | bug-triage | in-review |
| B-15 | There is no way to clear the own channel from the my channel page | low | enhancement | bug-triage | open |
| B-16 | Browse-e2e journeys are blocked on missing `data-testid`s: `mine-tab-month`/`mine-tab-posts`/`mine-tab-metrics` (tab strip in `mine/page.tsx`), `mine-stat-tile` (`own-stat-tiles.tsx`), `mine-reach-bars` (`reach-by-post-bars.tsx`), `mine-post-row` (`OwnPostList` in `reach-by-post-bars.tsx`), `mine-weekday-bar` (`own-weekday-rhythm.tsx`), `mine-connect-panel`/`mine-connect-check`/`mine-connect-measure` (`graph-connect-panel.tsx`), `mine-delete-undo` (delete toast Undo action in `mine-calendar.tsx`), and the plan-dialog fields `plan-dialog-no-script-ack`/`plan-dialog-script`/`plan-dialog-date`/`plan-dialog-video-kind` (`plan-dialog.tsx`). E2E-04 to E2E-11 name these and are blocked until they are added. | low | test-coverage | test-cases-mandate | done ([plan](../../../planning/implementation-plan/2026-09-29-cross-mine-dashboard-rework.md)) |
| B-17 | The calendar links a published plan to `/mine/<id>`, a route that does not exist | medium | bug | phase-2-design | open |
| B-18 | Audience details shows the "100 or more engagements" message for any stored `own_audience_fetch_error`, not only a volume refusal, and hides the older stored audience rows while the error is set | low | bug | code-review | done |
| B-19 | My reels runs a live Graph token check (`checkGraphTokenAction`) on every render, one network call per page view | low | enhancement | code-review | done |
| B-20 | With no token configured, My reels shows the connect panel alone and hides numbers measured earlier, unlike a rejected token, which stacks the panel over them | low | enhancement | code-review | open |
| B-21 | A refused account breakdown writes no row, so every hourly tick retries it, about four Graph calls an hour; a stored refusal time would stop that | low | enhancement | code-review | open |
| B-22 | `topbar.tsx` still maps `/mine` to the title "My channel", a row no request reaches now that `/mine` answers a 307 | low | enhancement | code-review | done |
| B-23 | How long a stored `thumbnail_url` (an Instagram CDN link) stays valid is not measured; the daily sweep refreshes it | low | enhancement | doc-sync | open |
| B-24 | The calendar's "today" and the missed rule use the UTC date (`toISOString().slice(0, 10)` in `planned-posts.ts`), so east of UTC the grid marks yesterday as today after local midnight until UTC catches up | low | bug | phase-4b-test | open |
