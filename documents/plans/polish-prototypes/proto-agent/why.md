# Why the Line

## The idea in 5 lines

1. Lead Studio is a production line you supervise, not a workspace you operate.
2. Six stations run across the top of every screen: circles run by themselves, diamonds need you, beads are your reels.
3. The mascot watches Claude for you, sits on the line where the work is, and its pose tells you the state from across the room.
4. The Desk holds only what needs you, most stuck first, answered in place, and says when you will next be needed so you can leave.
5. You can always step in: a note with a receipt, a switch to stop at the draft, and Claude's screen with take over when you want your hands on it.

## What happens to the Orca shell

Gone from view: the tab strip, the file column, the workspace list, the "+" developer menu, the ORCA first screen, "Loading editor...", the status bar. The terminal stays as an engine and shows up in one place only, "See Claude's screen" on a cooking reel. The rest (browser, split panes) moves behind a Workshop switch in Settings, off by default.

## What happens to the 11 boards

| Board | Fate | Where it goes |
| --- | --- | --- |
| Today | Replaced | The Desk: asks, working now, since you left. The repeated funnel strip and pull list are cut. |
| Funnel | Merged | Insight, Funnel view, under Claude's read. |
| My channel | Merged | Insight, My channel view. |
| Rivals | Merged | Insight, Rivals view, with Take, Learn, Avoid and the add box kept. The repeated Outliers row is cut. |
| Plan | Kept | Plan station. Missing chips are cut. |
| Studio | Cut | Cook shows the current reel and what is next. Its best line stays as Cook's empty state. |
| Gate 1 | Renamed and rebuilt | Approve plan station. Reel-maker words and switches, with the code diff cut. |
| Gate 2 | Renamed | Approve post station. Video, caption, 5 checks, and it says it can't be undone. |
| Agents | Moved | Settings, "Who does the work". The line about never calling a model stays. |
| Cook pane | Kept and promoted | Cook station. Reel first, status card with YOU CAN and IF YOU WAIT, then trail. Terminal is hidden by default. |
| Sources | Moved | Pull station, as a tick table. Accounts move to Settings. |

## The mascot's job

| Moment | Pose | What it tells you |
| --- | --- | --- |
| First open | Waving, happy | Says what it does and offers one button |
| Empty station | Magnifier, curious | Nothing here yet |
| Claude waits for you | Waving | Sits on the station that needs you |
| Working | Laptop, focused | Sits on the station that is working |
| Long wait | Thinking | Still alive, only slow |
| Error | Surprised | Beside the card that says what is kept |
| Limited | Asleep | Resting until the time on the card |
| Posted | Cheering, with confetti | The only time it celebrates |

## What it cuts

Tabs, panes and files in daily use. Six board names from the sidebar. The separate home dashboard of numbers. Search and the command menu in this prototype: the Line is short enough that number keys 0 to 6 reach everything.

## What it loses

- **Doing it by hand gets one step further away.** If Kai wants a terminal open beside a board every day, this hurts. The Workshop switch is the answer, and it is not built here.
- **Numbers at a glance on open.** The old Today showed the funnel on arrival. Here you go to Insight. It is a real trade for people who start the day with numbers.
- **The forecast can be wrong.** "About 14:40" is built from usual times, so it will miss sometimes. It needs to correct itself out loud or people stop trusting it.
- **Answering in place needs more from Claude.** Today Claude asks in the terminal in free text. Buttons on the Desk only work for questions shaped as choices. Everything else still needs a text box.
- **Many reels strain the Line.** Beads read well up to a handful of reels. A day with 10 running would need a count instead.
- **The second route and Codex handoff are shown as one-button moves.** They are simplified for the prototype.

## Honest build cost

Guess, not an estimate from code reading of every part. One engineer plus agents.

| Slice | Guess |
| --- | --- |
| Hide the shell while the Line is showing, station nav, Desk with derived asks | 1 to 1.5 weeks |
| Mascot in the app, one shared renderer, states mapped | 2 to 4 days |
| Board moves and copy pass for all 7 screens and 6 states | 1 to 2 weeks |
| Question in place, from Claude's wait to Desk buttons and back | 3 to 5 days, the riskiest part |
| Note receipts: sent is easy, read and done need Claude to report back | 3 to 5 days |
| Next-need forecast from past run times | 2 to 3 days |

Total guess: 4 to 6 weeks to match this prototype on real data.
