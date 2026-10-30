# Why this one: "One sentence"

## The idea in 5 lines

1. Every screen opens with one sentence that says what is true, then the one button that follows from it.
2. Four words on top (Today, Numbers, Plan, Cook) replace the sidebar of 11 boards.
3. Waiting, errors and limits all use one shape: sentence, detail, YOU CAN, IF YOU WAIT, button, with finished work kept below.
4. The two approvals stop being places. Each is a card that opens over your work and closes back to it.
5. The mascot is the app's only status light: large when the screen has nothing better to show, small in the top bar when work runs elsewhere, absent from the middle of work.

## What happens to the Orca shell

Gone from view. No tabs, file column, ORCA screen or "+" menu. The workspace stays in the build and sits behind one door: "Show the work" on Cook, and "The workspace" in Settings. Nobody has to open it to make a reel. In the prototype that door opens a drawer with a mock terminal. In the real app it would open the existing panes.

## What happens to each board

| Board | Decision | Where it goes |
| --- | --- | --- |
| Today | Keep, rewritten | The next thing to do, where the reel is on its path, one line since yesterday. No number tiles. |
| Funnel | Merge | Numbers, "Your reels". The per-keyword split stays. |
| My channel | Merge | Numbers, "Your reels", as a short section. |
| Rivals | Keep | Numbers, "Rivals": Take, Learn, Avoid, each with "Add to plan" and a link to the post. |
| Plan | Keep | A week as 7 plain rows. Cook starts on the row. A reel's details open as a card from its row. |
| Studio | Cut | Its list of reels becomes the Cook page when nothing is cooking. |
| Gate 1 | Merge | The "Check the plan" card over Plan. Plain sentences and reasons, no diff editor. |
| Gate 2 | Merge | The "Ready to go out?" card over Cook, including publish. |
| Agents | Merge | Settings, "Who does the thinking". |
| Cook pane | Keep, stripped | The Cook page: one sentence, step of 6, time against usual, the reel's reserved shape. |
| Sources | Merge | Settings, as a tick list where only the row that needs fixing has a button. Pull buttons live on Numbers. |

## What it cuts

- 7 of 11 places to go, the tab strip and split panes as the default view.
- Number tiles on Today, and the repeats between Today, Funnel and My channel.
- Percent bars, red error cards, and motion on navigation.
- Month and day views of Plan. They are not in this prototype.

## What it loses

- **Glanceability.** Someone who likes a wall of numbers now reads one sentence and a list. A heavy data user may miss it.
- **Parallel work in view.** Seeing a terminal, a board and a browser side by side is no longer the default. The drawer shows one thing at a time, so a power user opens the full workspace more often.
- **A place for each approval.** There is no list of past approvals here. The approval log in the spec still needs a home, probably in Settings.
- **Spec coverage.** Leads, Money and Website from the older spec, month and day Plan views, and version undo are not drawn. They would need to fit under Numbers and Plan without breaking the one-sentence rule.
- **Writing load.** The whole idea depends on a true, specific sentence for each screen and state. A generic one would expose the design badly. Those sentences have to come from real numbers by fixed rules, because the app itself has no model to write them.

## Honest build cost (a guess, not a measurement)

| Part | Guess |
| --- | --- |
| Hide the Orca shell behind one door, top bar, routing | 3 to 5 days |
| Shared status component and copy pass | 2 to 3 days |
| Numbers and Today rewrite, sentence rules from real data | 4 to 6 days |
| Plan rows, approval cards | 3 to 4 days |
| Cook page on the existing cook progress | 2 to 3 days |
| Mascot in the app, one instance moving between places | 2 to 3 days |
| Settings merge | 1 to 2 days |

Total guess: 17 to 26 agent-days of work, before review and proof. The largest unknown is hiding the Orca shell without breaking the workspace code behind it. I have not tried that in the app.

## Notes for the real build

- The mascot source is copied unchanged from `documents/brand/mascot/index.html` at build time. It loads three.js 0.160.0 from cdnjs, and the app would bundle it.
- The small mascot renders at half frame rate to keep the Mac cool. CPU and GPU use on a real Mac were not measured. The check ran with software rendering.
- The left end of the top bar needs room for the macOS window buttons, which this page does not draw.
