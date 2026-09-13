# mine: backlog to enhance

Bugs and enhancements for mine. One row per item.

| ID | Title | Severity | Type | Source | Status |
| --- | --- | --- | --- | --- | --- |
| B-04 | A plan edit is up to four separate writes with no rollback, so a mid-sequence failure leaves a partial edit | medium | bug | bug-triage | done |
| B-09 | The calendar delete Undo is lossy, dropping id, remix session, source video, video kind, time, and target length on re-create | medium | bug | bug-triage | in-review |
| B-15 | There is no way to clear the own channel from the my channel page | low | enhancement | bug-triage | open |
| B-16 | Browse-e2e journeys are blocked on missing `data-testid`s: `mine-tab-month`/`mine-tab-posts`/`mine-tab-metrics` (tab strip in `mine/page.tsx`), `mine-stat-tile` (`own-stat-tiles.tsx`), `mine-reach-bars` (`reach-by-post-bars.tsx`), `mine-post-row` (`OwnPostList` in `reach-by-post-bars.tsx`), `mine-weekday-bar` (`own-weekday-rhythm.tsx`), `mine-connect-panel`/`mine-connect-check`/`mine-connect-measure` (`graph-connect-panel.tsx`), `mine-delete-undo` (delete toast Undo action in `mine-calendar.tsx`), and the plan-dialog fields `plan-dialog-no-script-ack`/`plan-dialog-script`/`plan-dialog-date`/`plan-dialog-video-kind` (`plan-dialog.tsx`). E2E-04 to E2E-11 name these and are blocked until they are added. | low | test-coverage | test-cases-mandate | open |
