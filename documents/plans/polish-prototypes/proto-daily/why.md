# Why this one: the day is a timeline

## The idea in 5 lines

1. The top of the app is an edit track of your day: six clips, a playhead on now, tonight's post time as the last mark.
2. Under it, one sentence and one next step. Return does it.
3. Everything else is one key away: Week, Numbers, Find anything.
4. Each state is drawn on the clip, so a glance from across the room tells you running, slow, stopped or waiting.
5. The mascot does the waiting with you, and goes to sleep when the day is done.

## The Orca shell

Gone from view. No tab strip, file column, sidebar, or "+" menu on the daily path. The workspace stays, one door away: "Show the work" on a cook, Settings, and Find anything. The code underneath is not removed.

## The 11 boards

| Board | Decision | Where it goes |
| --- | --- | --- |
| Today | Keep, rebuilt | The home. One sentence, one next step, then, tonight, done. No number tiles. |
| Funnel | Merge | Numbers, "From view to sale". Keeps the per-keyword split and a source and pull time on every number. |
| My channel | Merge | Numbers, "Your channel". |
| Rivals | Merge | Numbers, "Rivals". Keeps Take, Learn, Avoid. "Pull" moves here too. |
| Plan | Keep, renamed Week | One list of 5 reels, one row opens at a time. The month chips are cut. |
| Studio | Cut | Its best line stays: "Nothing is cooking. Cook a reel from Week." |
| Gate 1 | Rename and fold | "Approve the plan": plain sentences with a reason and a live count on the button. |
| Gate 2 | Rename and fold | "Watch" and "Approve and post". |
| Agents | Move | Settings, "Helpers on this Mac". |
| Cook pane | Keep, rebuilt | A page: 6 steps, the reserved video shape, YOU CAN and IF YOU WAIT. Terminal and files behind "Show the work". |
| Sources | Move | Settings, with one tick row per source. |

## What it cuts

- The sidebar and its 3 groups, down to Today, Week and Numbers.
- Developer words on the daily path.
- Percent bars on long cooks, as a rule: counts and clocks only.
- Red overdue counts and streaks.

## What it loses

- **Glanceable numbers on open.** Today shows one finding, not a dashboard. If you like to scan six numbers each morning, that is one more key.
- **Side-by-side work.** One screen, one job. A terminal next to the reel is now a door away, which is slower for a power user cooking several reels at once.
- **Several reels at once is thin.** The track assumes one main reel per day. A second cook today would need a second track row. Not designed here.
- **Direct access to every board's old tabs.** Numbers is one long page until proven too long.
- **A fixed morning order.** The track reads left to right, so an out-of-order day (cook first, plan later) looks odd. Clicking a clip still goes there.

## Build cost (a guess, not measured)

| Slice | Guess |
| --- | --- |
| Hide the shell for daily pages, new top bar and action bar | 3 to 4 days |
| Day track wired to real pull, plan and cook state | 3 to 5 days |
| Today, Week, Numbers built from existing board data | 1 to 1.5 weeks |
| Approve and Watch pages on the existing gate logic | 3 to 4 days |
| Mascot in the app, one canvas, plus a low-power fallback | 2 to 3 days |
| Copy pass and every state on real services | 1 week |
| **Total, one builder** | **about 4 to 5 weeks** |

The three.js renderer adds to the bundle and needs a GPU check on older Macs. I did not measure this on real hardware: proof runs used software rendering.
