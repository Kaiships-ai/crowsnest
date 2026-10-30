# Research: what makes a tool feel great, and what Lead Studio should do

The lane brief named no lens, so this lane looks at one question: which structure lets one reel maker move through Pull, Insight, Plan, approve, Cook, approve and publish with the least noise.

How much each source was read is stated. "Read" means the page was fetched. "Search summary" means only the search result text was seen; the page itself may say more.

## What I looked at

| Source | Depth | What it says |
| --- | --- | --- |
| [Linear, behind the latest design refresh](https://linear.app/blog/behind-the-latest-design-refresh) | Read | The sidebar went "a few notches dimmer, allowing the main content area, where users work, to take precedence". They also say "If most people don't immediately notice what changed, that's probably a good sign." |
| [Linear, 2026 UI refresh changelog](https://linear.app/changelog/2026-03-12-ui-refresh) | Search summary | Calmer and more consistent, so people can scan and stay focused. |
| [Linear, how we redesigned the UI](https://linear.app/blog/how-we-redesigned-the-linear-ui) | Search summary | They worked by type of view and rolled out to a share of workspaces per day. |
| [Superhuman, built for speed](https://blog.superhuman.com/superhuman-is-built-for-speed/) | Read | Treats 100 ms as the limit for "feels immediate" and aims for under 50 ms when possible. |
| [UX Design, "So you're building a Superhuman of X"](https://uxdesign.cc/so-youre-building-a-superhuman-of-x-b39015f3d7a6) | Search summary | Tool speed does not help if the task itself is slow. Opinionated flows matter as much. |
| [Nielsen Norman Group, 3 response time limits](https://www.nngroup.com/articles/response-times-3-important-limits/) | Read | 0.1 s feels instant, 1 s keeps the flow of thought, 10 s is where attention leaves. Long waits need feedback on when it will finish. |
| [The Plus Addons, skeleton screens summary](https://theplusaddons.com/blog/skeleton-loading-screen/) | Search summary | Evidence on skeletons conflicts. It reports a Viget study (136 people) where skeletons felt slowest, and Mejtoft et al. 2018 where they scored better. Secondary source. |
| [Design Week, Duolingo owl makeover](https://www.designweek.co.uk/issues/2-6-january-2019/duolingo-owl-receives-makeover-as-app-becomes-more-gamified) | Search summary (fetch refused with 403) | Duo was redrawn with simple shapes to animate easily and given a wider emotional range. Animation was kept for the most rewarding moments. |
| [Outlook India, Duolingo's "sick" icon](https://outlookindia.com/international/us/duolingos-new-sick-app-icon-why-users-are-concerned-and-how-to-change-it-explained) | Search summary | Some users were upset by a sickly owl, and one says they deleted the app. A real user reaction, but thin. |
| [5 lessons from Clippy's failure](https://medium.com/twentybn/5-lessons-from-clippys-failure-efc69297eac1) and [Duo Security on Clippy](https://duo.com/blog/killing-clippy-lessons-in-usability-and-legacy-code) | Search summary | Retrospectives agree on interruption at the wrong moment and poor control. Opinion pieces, not studies. |
| [G2 compare: Later, Metricool, Loomly](https://www.g2.com/compare/later-social-vs-metricool-vs-loomly) | Search summary | Reviewers rate calendars about equally across tools (9.1 to 9.4). Later's approval flow rates lowest (7.4 against 8.7 and 8.6). |
| [Metricool approval tool](https://metricool.com/social-media-approval-tool/) | Search summary | A "Pending approval" status shows on the calendar. Vendor page. |
| [eesel on OpusClip reviews](https://www.eesel.ai/blog/opusclip-reviews) and [Descript vs OpusClip on G2](https://www.g2.com/compare/descript-vs-opusclip) | Search summary | Creators value time saved. Complaints are about reliability, failed processing and bugs on long projects. I found no direct evidence about interface clutter. |
| `documents/plans/polish-study.md` on branch `KineBeo/polish-study` | Read | Claude Desktop vs Lead Studio across 8 moments, keep/cut/merge per board, and the three ideas used here. |
| Spec in `proto/`, `proposal/data.js`, `proposal/wireframes.js` | Read in part (fake data and screen list) | Board names, loop steps and sample shapes. |
| `.claude/skills/hallmark`, `.claude/skills/emil-design-eng` | Read in part | Structure over reskin, no re-drawn chrome, ease-out, no scale from zero, honest copy. |

## What works, and why

- **Quiet around the work.** Linear dimmed the navigation so the work wins. The study found the same gap: Lead's boards share the window with a file column, 9 clipped tabs and a developer menu.
- **An answer at once.** The 0.1 s limit and Superhuman's target agree. So every click here changes the screen in the same frame, and slow work runs behind a shape that is already in place.
- **Say when, and say why.** NN/g asks long waits to show when they end. Lead's "Taking longer than usual (2:00)" already does this and is better than the Claude behavior in the study. It stays.
- **Reserved shape, used with care.** Evidence on skeletons conflicts, so they appear only where the final shape is known (funnel bars, day cells), never as a whole-page shimmer.
- **Approval on the plan itself.** Calendars score about the same everywhere, while approval flows vary. That makes approval a place to win, and it is why versions B and C put it where the work is.
- **A character with moods tied to events.** Duo's range works because it reacts to what just happened. The mascot here reacts to product state only.

## What to refuse

- A mascot that speaks first, gives tips or interrupts. That is the repeated complaint about Clippy.
- A mascot that makes the user feel guilty. Duolingo's crying and sick owl draws both memes and upset users; a work tool has no reason to risk it.
- A mascot on every screen. Here it has six jobs: greet at first open, sleep when empty or limited, work while waiting, look surprised on an error, cheer on a finished reel or a schedule, and report status in a small pill while you are elsewhere. It rests otherwise, and the logo is a still image.
- Fake percent bars on work with no known length.
- Copying Claude's cream, serif and terracotta, or Orca's neutral look. The palette comes from the mascot: plum ink, peach for the one primary action.
- Code names on screen.

## Strategy

Build three real structures on one look, so Kai compares structure and not color. The shared parts (states, copy, mascot) are the same in all three, and each version composes them differently: A keeps boards, B folds them into one page, C puts the reel in the center.

My pick is B, because the study shows Today repeating three other boards, so folding removes the most. Its first PR is the same as A, so stopping early still leaves a working product.

## Rejected alternatives

1. **New theme on the current boards.** Cheapest, but the study's top problem is structure: the Orca shell and repeated numbers survive any color change.
2. **Chat-first home, one composer that does everything.** Close to recreating Claude. Approval and the funnel also need to be seen at a glance, not asked for.
