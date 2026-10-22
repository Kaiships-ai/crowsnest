# Week cases

## Built features

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 1 | Land on Tuần này | `/` shows the week screen with one next-action chip and today's reels | ● | `src/components/week/week-tab.tsx`, `week-screen.tsx`, `src/app/(shell)/(loaded)/page.tsx` | none |
| 2 | Today and week split | "Hôm nay" cards open, "Cả tuần" collapsed with one list per day | ● | `week-model.ts` (`splitWeek`) | none |
| 3 | Drag a reel to another day | Optimistic move through `movePlannedPostAction`: state kept, `scheduledAt` carried, published refused, past days not targets; undo restores the prior snapshot | ● | `week-screen.tsx` (`moveTo`) | none |
| 4 | Reel drawer | Five steps, inline hook, keyword, video, publish gate with confirm, funnel tiles | ● | `week-screen.tsx` (`ReelDrawer`) | none |
| 5 | Approve and undo a plan draft | Draft bar for a proposed week version newer than the live one | ● | `approvePlanVersionAction`, `undoPlanVersionAction` | No discard: plan versions have no reject |
| 6 | Ask Claude for next week | Copies a prompt naming the MCP plan tools | ● | `week-screen.tsx` (`ask`) | none |
| 7 | Keyboard move | "Chuyển sang ngày" select in the drawer, same save and undo as a drop | ● | `week-screen.tsx` (`week-move-select`) | none |
| 8 | Hook on the remix session | Edits `remix_sessions.chosen_hook`; no linked session shows an empty step with "Mở remix" | ● | `updateStageAction` | none |
| 9 | Source removed | Red line on the card, row, and drawer when the source video has `deletedAt` | ● | `week-tab.tsx` (`sourceGone`) | none |
| 10 | Sync status | Live progress line while a sync runs, a failed sync links to its run | ● | `useRunStream` | none |
| 11 | Broken Graph token line | One red line on Tuần này and Nguồn when the cached token state is `auth_failed` or `permission_denied`, linking to the Graph API card in Cài đặt; it reads the cache only. Check clears `auth_failed`; `permission_denied` clears on a good measurement or a new token | ● | `src/components/status/graph-token-line.tsx`, `week-tab.tsx` | none |
| 12 | Old Dashboard links | Any `/?tab=` value redirects to `/` | ● | `src/proxy.ts` | none |
| 13 | Recover a publish from the drawer | A failed reel offers "Thử đăng lại" until the attempt cap, then says why; a reel with a publish time offers "Huỷ lịch đăng" behind a confirm and goes back to draft on its day and time | ● | `week-screen.tsx`, `retryFailedPublishAction`, `cancelScheduledPublishAction` | none |
| 14 | Edit and delete a reel | "Sửa plan" opens the plan dialog and re-dates by the move rules; "Xoá reel" deletes with an undo toast that restores every column; a publishing reel cannot be deleted | ● | `week-screen.tsx`, `plan-dialog.tsx`, `savePlanEditAction`, `deletePlannedPostAction` | none |
| 15 | Drawer motion | The reel drawer slides in and out on the drawer curve; arrow keys step reels inside it without replaying the slide; under reduced motion it fades without sliding | ● | `week-screen.tsx` (`ReelDrawer`), `src/components/ui/sheet.tsx`, `src/app/globals.css` | none |

## Test cases

- J1 rest. Open `/`. `data-testid="week-screen"` shows, `data-testid="week-next-action"` is one chip, and `data-testid="week-today-card"` appears once per reel dated today.
- J2 plan. With a proposed week version, `data-testid="week-draft-bar"` shows. Press `data-testid="week-draft-approve"`; `data-testid="week-plan-version"` names the new version. Press `data-testid="week-approve-undo"`; the old version is live again.
- J3 publish. Open a ready reel, press `data-testid="week-publish"`. `data-testid="week-publish-confirm"` asks first; `data-testid="week-publish-go"` publishes. In dry run, `data-testid="week-published"` says dry run.
- Drag. Open `data-testid="week-toggle"`, drag a `data-testid="week-row"` onto another `data-testid="week-day"`, reload. The reel stays on the new day. `data-testid="week-move-undo"` moves it back.
- Hook. In `data-testid="week-drawer"` for a reel with a remix session, type in `data-testid="week-hook-input"` and press Esc. The drawer closes and `remix_sessions.chosen_hook` holds the edit. A reel with no session shows `data-testid="week-hook-empty"`.
- Keyboard move. In the drawer, pick another day in `data-testid="week-move-select"` with the keyboard. The reel moves at once and `data-testid="week-move-undo"` moves it back.
- Move rules. Move an armed reel: its `scheduled_at` moves to the new day at the same time. Move a failed reel: it stays failed with its error. A published reel in a stale tab: the move is refused and the reel stays. Past days take no drop and are not in the select.
- Hook template. With a remix session topic, a `{topic}` template saves the filled hook. A template with another slot stays in `data-testid="week-hook-input"` and `chosen_hook` is unchanged.
- Note on close. Type in `data-testid="week-note-input"` and press Esc; the note is saved.
- Drawer enter and exit. Click a `data-testid="week-today-card"`; `data-testid="week-drawer"` starts translated and transparent and settles at full opacity with no translate over about 200ms. Press Esc; it fades and slides out over about 200ms before leaving the DOM, still showing the same reel's title.
- Keyboard step. With the drawer open and focus outside an input, press ArrowDown; the same `data-testid="week-drawer"` element shows the next reel's title at once with no slide, and `data-testid="week-note-input"` shows that reel's note.
- Reduced motion. With `prefers-reduced-motion: reduce`, open and close the drawer; it fades in and out with no translate at any frame.
- Sidebar Back. From `/`, open Nguồn and press Back; the rail marks Tuần này.
- J6 broken token. With the cached Graph token state `auth_failed` or `permission_denied`, `data-testid="graph-token-line"` shows one red line on `/` and on `/feed`, `/channels`, `/channels/discover`. It links to `/settings#graph-api`; there, press `data-testid="mine-connect-check"`: an `auth_failed` line is gone on the next render once the token works. A `permission_denied` line stays until a measurement succeeds or the token is saved again. With Graph unreachable the page renders without waiting. With a missing token or a healthy one, no line shows.
- Funnel. A reel with a keyword and saved rows shows numbers in the `data-testid="week-funnel-tile"` tiles whose `data-metric` is `dms`, `emails`, and `orders`; a metric with no row reads "chưa đo".
- Cancel publish. On a reel with a publish time press `data-testid="week-cancel-publish"`, then `week-cancel-confirm-confirm`; the row is `draft`, keeps `planned_date` and `planned_time`, and `scheduled_at` and `idempotency_key` are null. A scheduler tick after it claims nothing.
- Edit a reel's date. In "Sửa plan" change the date: a failed reel stays `failed`; an armed reel's `scheduled_at` moves by the same days and `planned_time` is kept; a past date is refused.
- Delete then undo. Press `week-delete`, then the toast's `week-delete-undo`; every column of the row equals the row before the delete. A `publishing` reel cannot be deleted.
- Retry cap. A failed reel with `attempt_count` 3 shows `week-retry-exhausted` and no `week-retry`.
- Retry. On a failed reel press `data-testid="week-retry"`; the row is `scheduled` with no `last_error`. With PUBLISH_DRY_RUN=1 the scheduler only dry-runs it.
- Delete and undo. Press `data-testid="week-delete"`; the row is gone; press `week-delete-undo` in the toast; it is back on its day.
- Edit. Press `data-testid="week-edit"`, change the title, save; the row title changes.
- Phone. At 400 px width the page has no horizontal scroll.
