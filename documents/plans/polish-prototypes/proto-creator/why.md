# Why this one: the bench

## The idea in 5 lines

1. Lead Studio stops being a set of boards and becomes one editor's bench: monitor, desk, note, timeline.
2. Every reel is a clip on one timeline, from an empty day to its last sale.
3. Zoom is the navigation: month, week, then the seconds of one reel, with no screen change.
4. Numbers sit on the moment they describe: retention under the script, the funnel straight after the last second.
5. The mascot sits wherever the next thing is, so you can always find your next job at a glance.

## The 11 boards and the Orca shell

| Today | Decision | Where it goes |
| --- | --- | --- |
| Orca shell | Hidden | File tree, tabs and the ORCA screen leave the product view. The terminal stays under "Under the hood" (Ctrl+`). Agents still run there. |
| Today | Merged | The app's home screen: what waits on you, in order. The Today tile row goes away, since the timeline already shows it. |
| Funnel | Merged | "After the reel" on each clip, plus Insight > Keywords for the per-keyword split. |
| My channel | Merged | Month zoom on the timeline, plus Insight > My channel. |
| Rivals | Merged | Insight > Rivals keeps Take, Learn and Avoid. Rival reels also get their own lane on the timeline. Outliers go; they repeat Take. |
| Plan | Kept, changed | Step 3. The timeline is the calendar and the script is the reel. |
| Studio | Cut | A cook is a state of a clip, so an empty list of cooks has no job. |
| Gate 1 | Renamed | Step 4, "Approve plan". Old line, new line and why, in place of a code diff. |
| Gate 2 | Renamed | Step 6, "Final check". Merged with the post sheet. |
| Agents | Moved | "Sources and helpers" sheet. Setup work, not daily work. |
| Cook pane | Kept, changed | Step 5. It keeps its best parts: named actor, step count, time against usual, YOU CAN, IF YOU WAIT, kept work. Paths and pid move under the hood. |
| Sources | Moved | Step 1 for pulling, and the same sheet as Agents for connecting. |

## What it cuts

Studio as a place, the tab strip, the "+" menu, the workspace sidebar, Today's tile rows, board-to-board navigation, and the words Gate, sidecar, pid and session in the product view.

## What it loses

- **Several things side by side.** Orca's split panes let you see a terminal, a browser and a board at once. Here you get one job at a time. A maker who likes watching Claude work has to open a drawer.
- **The browser tab and free workspaces.** Rival research by an agent in a browser tab, and any non-reel work, have no home on this screen. They would need a second "workspace" mode, which this prototype does not design.
- **Scale.** A timeline reads well at about one reel a day. Several reels a day on one channel, or many channels, would need lanes and were not tested.
- **The month view is thin on a phone.** Clips get too narrow for titles. It is a desktop app, so I accepted that.
- **Fast access to a table of every reel.** Sorting all reels by follows, as My channel's table does today, has no direct equivalent here beyond Keywords.
- **The mascot may tire.** It moves and talks on every state change. Kai should judge this after a real week; a quieter setting may be needed.

## Honest build cost (a guess, not a measurement)

| Part | Guess |
| --- | --- |
| Hide the shell, new top bar and bench layout | 3 to 5 days |
| Zoomable timeline with clip states, on real plan and post data | 5 to 8 days |
| Retention curve with skimming | 2 to 3 days for the UI. The data is the risk: `src/server/graph/client.ts` holds average and total watch time, and I found no per-second retention or skip rate in `src/server`. I did not check whether Instagram's API offers them. Without them, the reel view shows one "average watch time" marker on the script, and the headline idea gets weaker. |
| Moving each board's content into steps and tabs | 8 to 12 days |
| Mascot in the app (one canvas, slots, states) | 2 to 3 days |
| Copy pass and every state | 3 to 5 days |
| Total | 4 to 7 working weeks for one builder, before review rounds |

The prototype fakes all data and does not prove any of these wire up.
