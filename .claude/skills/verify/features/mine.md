# My channel

The operator's own channel: a month calendar of planned and published posts.

## Sub-features

- Month tab (default) with one cell per day (`mine-calendar-day`, `data-id=YYYY-MM-DD`).
- Plan a post on an open day (`mine-calendar-plan-day`), which writes a `planned_posts` row.

## How to get to it (user POV)

Sidebar, Sources, My channel (`/mine`). The seeded channel is already marked own.

## Driving it with browse

`drive.sh mine-e2e-02`. It plans "E2E fixture plan <pid>" on the 15th of the current month and finds it on the grid. Side effect: `sqlite3 data/e2e.db "select title from planned_posts"`.

## Gotchas

- The seed has no planned or own posts, so every day is "open"; the journey relies on that.
