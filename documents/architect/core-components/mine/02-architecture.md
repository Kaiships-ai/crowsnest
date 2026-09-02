# mine: architecture

## Key files

- `src/app/(shell)/mine/page.tsx`: the my channel page frame. Reads the own channel
  first (the gate), then fires six reads at once and decides what to render.
- `src/app/(shell)/mine/[postId]/studio/page.tsx`: the studio entry for one planned post;
  hands off to the [studio](../studio/02-architecture.md) component (`getStudioBrief`).
- `src/components/mine/`: the screen's pieces — `own-channel-picker.tsx` (the no-own-channel
  gate), `graph-connect-panel.tsx` (the no/invalid-token gate), `own-stat-tiles.tsx`,
  `reach-by-post-bars.tsx` (also exports `OwnPostList`), `own-weekday-rhythm.tsx`,
  `mine-calendar.tsx` (the Month grid + day detail panel), and `plan-dialog.tsx`.
- `src/server/queries/own-channel.ts`: `getOwnChannelOverview` (the metrics band,
  `DEFAULT_WINDOW_DAYS` = 30) and `getOwnPosts` (newest first, limit 100).
- `src/server/queries/planned-posts.ts`: `getCalendarMonth`, `getPlannedPosts` — where
  "missed" is derived on read from today against `plannedDate`.
- `src/server/queries/channels.ts`: `getOwnChannel` (`channels.isOwn`).
- `src/server/actions/planned-post-actions.ts`: the eight plan writes —
  `createPlannedPostAction`, `updatePlannedPostAction`, `schedule`/`unschedulePlannedPostAction`,
  `attach`/`detachScriptFromPlanAction`, `markPlanPublishedAction`, `deletePlannedPostAction`.
- `src/server/actions/channel-actions.ts`: `setOwnChannelAction` / `unsetOwnChannelAction`.
- `src/server/actions/graph-actions.ts`: `checkGraphTokenAction`, `measureOwnChannelAction`.
- `src/server/queries/vault.ts`: `getScripts`, read only to populate the plan dialog's
  script select.

## Data flow

**Arrive.** `MinePage` reads `getOwnChannel()` first. If none, it renders
`OwnChannelPicker` over the tracked channels and stops — no other work. If one, it runs
six reads in one `Promise.all`: `checkGraphTokenAction`, `getOwnChannelOverview`,
`getOwnPosts({ limit: 100 })`, `getScripts` (for the dialog), the `scoreMinUsablePosts`
setting, and `getCalendarMonth(month)` for the `?month=YYYY-MM` in the URL. From those it
derives three facts: `everMeasured` (an own account snapshot exists), `connected` (token
state `ok` and ever measured), and the progress percent (`totalPosts / scoreMinUsablePosts`,
capped at 100). The header is an `h2`, not `h1` — the topbar already renders the route
title "My channel"; this line names *which* channel is yours (`nav-items` `ROUTE_TITLES`).

**The two gates.** The metrics band is gated so real numbers are never faked and never
hidden. Token not configured, or invalid and never measured: only `GraphConnectPanel`
renders where the metrics would be. Token invalid but measured before: the panel stacks
*above* the real historical tiles, progress, and reach bars. Token ok and measured: the
full band, no panel. The tab strip (Month / Posts / Metrics) renders below a divider in
every case, opening on Month, which is client-only state (not a deep link; resets on
reload).

**Planner.** `getCalendarMonth` returns the month's plans, undated drafts, published
cells (from own posts), and dead-air runs. The calendar's day panel owns two writes,
`markPlanPublishedAction` and `deletePlannedPostAction`; both call a router refresh so the
grid re-reads. Creating or editing a plan opens `plan-dialog.tsx`. A create is one write.
An **edit is a sequence** of up to four separate actions in a fixed order (title/note →
date → script → video kind), each fired only if that field changed — there is no single
patch action.

## Decisions

- **Two independent gates, neither faked.** Own channel (`channels.isOwn`) and Graph
  token are checked separately; a missing token renders `GraphConnectPanel` (a plain
  statement of what's missing), not a spinner or zeros. A token that fails now and a
  channel measured before are different facts, so the panel stacks over real numbers
  rather than replacing them.
- **"Missed" is derived on read, never stored.** The stored `state` is only ever draft or
  scheduled; `getCalendarMonth`/`getPlannedPosts` compute missed from today's date, so a
  reschedule can't leave a stale "missed" behind. (The flip side: a hand-published past
  plan still reads as a red missed cell — B-08.)
- **A plan edit is a sequence with no rollback.** There is no single patch for a planned
  post, so a mid-sequence failure leaves a partial edit and one inline error that doesn't
  say which writes landed (B-04). The design values applying only changed fields over
  atomicity for a single-user local app.
- **No drag on the calendar.** Rescheduling is a date-field edit in the plan dialog; cells
  are plain buttons. The drag logic in `src/lib/kanban-moves.ts` belongs to the Channels
  board (`src/components/channels/kanban-board.tsx`), not here.
- **Own posts are read-only; the Graph measurement is the only writer.** The instagrapi
  sidecar writes tracked videos, never own posts, so a sync never changes this page. Own
  posts and planned posts are separate tables, never auto-linked; publishing is always a
  manual mark.
- **No auto-publish, no reminders.** A planned post is a dated intention only; the plan
  dialog carries no time or target-length field even though the record can hold both.
- **No UI to clear the own channel.** `unsetOwnChannelAction` exists but no control on the
  page calls it (B-15); the delete Undo re-creates a plan lossily, dropping id and several
  links (B-09). See [05-backlog-to-enhance](05-backlog-to-enhance.md).
