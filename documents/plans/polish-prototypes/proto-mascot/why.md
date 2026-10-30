# Why this prototype

## The idea in 5 lines

1. Bean, a small 3D runner, stands on a track of the 6 steps at the bottom of the window. Where Bean stands is where the work is.
2. Bean's pose is the state: laptop while cooking, slower when it runs long, asleep while a limit resets, hugging the reel on an error, holding it out when it needs your yes.
3. One screen, one job, and each headline is the answer ("Most people leave at the gift page."), not a board name.
4. Bean never opens anything by itself. It talks only when clicked, and every word is also written beside it, so Off loses nothing.
5. Claude writes, Bean carries, you say yes. One confetti in the whole app: when a reel goes live.

## The Orca shell

Hidden by default. No sidebar, no tab strip, no file column, no status bar. The terminal sits behind "Show Claude's terminal" on Cook. Settings has a "For developers" switch that brings the workspace back. In this prototype that switch is only described.

## The 11 boards

| Board | Decision |
| --- | --- |
| Today | Keep, as a home stop before the 6 steps. Only what needs you, one number, next 3 reels |
| Funnel | Merge into Insight, first tab |
| My channel | Merge into Insight, second tab |
| Rivals | Merge into Insight, third tab. Take, Learn, Avoid stay. The Outliers row is cut because it repeats Take |
| Plan | Keep, as the Plan step |
| Studio | Cut. "Nothing is cooking. Cook a reel from Plan." moves to Cook's empty state |
| Gate 1 | Rename to Approve. The code diff is replaced by 4 changes in words, each with a reason and an On or Off |
| Gate 2 | Merge into Publish. The approval and the publish are one screen |
| Agents | Move into Settings, as "Who does the writing" |
| Cook pane | Keep, as the Cook step. Its copy and step bar stay. The terminal and file tree are hidden |
| Sources | Keep, as the Pull step. Connection details move to Settings |

## What it cuts

Tabs, split panes, and seeing many things side by side. Sidebar navigation (7 stops and keys 0 to 6 replace it). Bean's other 4 colours from the brand sheet: one character, one colour. Pet mechanics: no streaks, levels or feeding.

## What it loses

- **Density.** A power user who wants funnel, plan and terminal side by side now has one screen. The developer switch is a weak answer.
- **Parallel work is under-modelled.** Bean can stand in one place. Two jobs at once (a pull during a cook) show only the latest job. This needs a real answer before a build: a small second marker, or a job list in Bean's sheet.
- **It will get compared to Clippy.** The press reached for that comparison with Mico. Some people will dislike any blob, and Off exists for them.
- **Cute risk.** A peach blob next to serious money numbers may feel too soft to some reel makers. I kept it small on the track and straight-faced on errors, but only real use will tell.
- **Bean's name is mine.** "Bean" and "runner" are working names. A name is Kai's call.
- **Motion cost is unmeasured on a real Mac.** The check ran on a software renderer. One WebGL canvas draws at about 30 fps when idle. It needs a CPU and GPU measurement before a build, and should drop further while a job runs in the background.

## Build cost (a guess, not a measurement)

| Part | Guess |
| --- | --- |
| Port Bean to a React component with one shared canvas, poses driven by app state | 3 to 5 days |
| Replace the shell with the track, hide Orca's chrome, keep the workspace reachable | 1 to 2 weeks, the riskiest part because Orca's layout assumes its tabs |
| Merge boards into 7 screens, copy pass, reserved shapes | 2 to 3 weeks |
| Rewrite Approve as plain changes from the existing plan versions | 3 to 5 days |
| Verify journeys and states | About 1 week |
| **Total, one builder and one reviewer** | **About 5 to 7 weeks** |

## Prototype limits

Fake data only. The jobs are timers. Bean's working name, the rival handles and every number are invented. Each step has all 6 states, and the state buttons in the grey bar set them directly. "Pull the rest (8) after 15:00" and the other limit buttons deliberately do nothing but say why.
