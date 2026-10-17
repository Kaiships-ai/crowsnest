# Week cases

## Built features

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 1 | Land on Tuần này | `/` with no tab shows the week screen with one next-action chip and today's reels | ● | `src/components/week/week-tab.tsx`, `week-screen.tsx`, `src/app/(shell)/(loaded)/page.tsx` | none |
| 2 | Today and week split | "Hôm nay" cards open, "Cả tuần" collapsed with one list per day | ● | `week-model.ts` (`splitWeek`) | none |
| 3 | Drag a reel to another day | Optimistic move, saved through `schedulePlannedPostAction`, undo in the toast | ● | `week-screen.tsx` (`moveTo`) | No keyboard move yet |
| 4 | Reel drawer | Five steps, inline hook, keyword, video, publish gate with confirm, funnel tiles | ● | `week-screen.tsx` (`ReelDrawer`) | none |
| 5 | Approve and undo a plan draft | Draft bar for a proposed week version newer than the live one | ● | `approvePlanVersionAction`, `undoPlanVersionAction` | No discard: plan versions have no reject |
| 6 | Ask Claude for next week | Copies a prompt naming the MCP plan tools | ● | `week-screen.tsx` (`ask`) | none |

## Test cases

- J1 rest. Open `/`. `data-testid="week-screen"` shows, `data-testid="week-next-action"` is one chip, and `data-testid="week-today-card"` appears once per reel dated today.
- J2 plan. With a proposed week version, `data-testid="week-draft-bar"` shows. Press `data-testid="week-draft-approve"`; `data-testid="week-plan-version"` names the new version. Press `data-testid="week-approve-undo"`; the old version is live again.
- J3 publish. Open a ready reel, press `data-testid="week-publish"`. `data-testid="week-publish-confirm"` asks first; `data-testid="week-publish-go"` publishes. In dry run, `data-testid="week-published"` says dry run.
- Drag. Open `data-testid="week-toggle"`, drag a `data-testid="week-row"` onto another `data-testid="week-day"`, reload. The reel stays on the new day. `data-testid="week-move-undo"` moves it back.
- Hook. In `data-testid="week-drawer"`, type in `data-testid="week-hook-input"` and press Esc. The drawer closes and the hook is saved.
- Funnel. A reel with a keyword and saved rows shows numbers in the `data-testid="week-funnel-tile"` tiles whose `data-metric` is `dms`, `emails`, and `orders`; a metric with no row reads "chưa đo".
- Phone. At 400 px width the page has no horizontal scroll.
