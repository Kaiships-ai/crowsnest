# My channel

The operator's own channel: a month calendar of planned and published posts, plus post and metric views.

## Sub-features

- Own-channel gate: with no channel marked own, `/mine` shows `OwnChannelPicker` instead of the calendar.
- Graph token status and `GraphConnectPanel`.
- Tabs: Month (default), Posts, Metrics. `?month=YYYY-MM` picks the month.
- Month cells (`mine-calendar-day`, `data-id=YYYY-MM-DD`). "Plan" on an open day (`mine-calendar-plan-day`) opens `PlanDialog` (`plan-dialog-title`, `plan-dialog-save`), which writes a `planned_posts` row and toasts "Planned".
- Planned posts can be edited, scheduled, unscheduled, deleted, and given a script (`src/server/actions/planned-post-actions.ts`).

## How to get to it (user POV)

Sidebar, Sources, My channel (`/mine`, rendered by `src/app/(shell)/(loaded)/mine/page.tsx`). The seeded channel is already marked own.

## Driving it with browse

`drive.sh mine-e2e-02`. It plans "E2E fixture plan <pid>" on the 15th of the current month and finds it on the grid. Side effect: `sqlite3 data/e2e.db "select title from planned_posts"`.

## Gotchas

- The seed has no planned or own posts, so every day is "open"; the journey relies on that.
- The journey ticks the dialog checkbox through `[data-slot="checkbox"]`, not a testid. A second checkbox in the dialog would break it.
