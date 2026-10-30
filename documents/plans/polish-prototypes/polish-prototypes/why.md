# Why: three versions, one pick

## The idea in 5 lines

1. Lead Studio looks like Orca because of the leftover shell and code names, not its colors.
2. A hides the shell and keeps every board. B folds the boards into one page. C makes the reel the center.
3. All three answer at once, fill a reserved shape, and speak the reel maker's words.
4. The real 3D mascot greets at first open, sleeps when empty or limited, works while waiting, and looks surprised on an error.
5. My pick is B, built by shipping A first.

## What each cuts

| Board | A | B | C |
| --- | --- | --- | --- |
| Orca shell | Hidden, one button brings it back | Off the main screen, "See Claude's work" | Off the main screen, "See Claude's work" |
| Today | Keep, shorter | The only home | Cut |
| Funnel | Keep | Tab in Numbers | Right column |
| My channel | Keep | Tab in Numbers | Cut |
| Rivals | Keep | Block on home | Right column |
| Plan | Keep week, month, day | 7-day strip plus a sheet | Left queue |
| Studio | Keep, holds Cook | Cut | Cut |
| Gate 1 | Keep as Approve plan | Opens in place | Center canvas |
| Gate 2 | Keep as Approve reel | Opens in place | Center canvas |
| Agents | Keep | Sheet | Settings |
| Cook pane | Inside Studio | Cooking block | Center canvas |
| Sources | Keep | Sheet | Settings |

## What each loses

- **A:** numbers still repeat across Today, Funnel and My channel, and there are still 10 places to go. It may still read as a dashboard.
- **B:** the page gets long, and a plan with many changes pushes everything down. The full text diff is gone, and the month view is off the first screen.
- **C:** the keyword table and the channel reel table are gone, along with the month view and any morning overview. A product called Lead pushes its lead numbers to the edge.

## Build cost (labelled guess)

These are guesses, not estimates from a plan. The line counts are real, from `src/renderer/src/components/board/`.

- **A:** about 3 PRs: hide the shell, one copy pass, mascot. Boards barely change.
- **B:** about 6 to 8 PRs: A, then fold `GateBoard.tsx` (402 lines) and `Gate2Board.tsx` (225) into `TodayBoard.tsx` (309), merge `FunnelBoard.tsx` (224) with `OwnBoard.tsx` (150) and `OwnPanels.tsx` (308), and rewrite the verify journeys and the matching wireframes.
- **C:** about 8 to 10 PRs: A, then rebuild navigation around `PlanBoard.tsx` (328) and `CookPane.tsx` (398), and rewrite most journeys.

The mascot adds three.js to the app, loaded from the bundle rather than a CDN. Each version draws it into small canvases and stops when none are on screen; its load on Kai's Mac has not been measured.
