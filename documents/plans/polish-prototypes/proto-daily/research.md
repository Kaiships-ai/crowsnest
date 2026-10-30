# Research: daily operating rhythm

Lens: a tool opened every morning that says what to do next. Claims below come from the linked pages. Where a source is a third party and not the maker, it says so.

## What I looked at

| Product | Source | What I took from it |
| --- | --- | --- |
| Linear | [Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh) | "Not every element of the interface should carry equal visual weight." Navigation should recede; the sidebar went "a few notches dimmer". "Structure should be felt not seen." Actions had stopped appearing in predictable places. |
| Linear | [UI refresh changelog](https://linear.app/changelog/2026-03-12-ui-refresh) | The stated goal is a calmer, more consistent interface, while keeping density. |
| Things 3 | [MacStories review](https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/) | Today lists events above tasks, and past events turn grey. "This Evening" separates day from night. Start dates decide when a task shows up, separate from deadlines. |
| Things 3 | [Design guide, third party](https://blakecrosley.com/guides/design/things) | Says the interface is about 95% neutral, with colour only for meaning. Not a Cultured Code statement. |
| Raycast | [A fresh look and feel](https://raycast.com/blog/a-fresh-look-and-feel) | Three principles: "fast, simple, and delightful". Actions, toasts and navigation titles joined into one bottom bar, and the bar teaches shortcuts. |
| Raycast | [Manual: keyboard shortcuts](https://manual.raycast.com/keyboard-shortcuts.md) | Return runs the primary action. |
| Notion Calendar | [Menu bar settings](https://www.notion.com/help/notion-calendar-settings), [TechCrunch launch piece](https://techcrunch.com/?p=2652678) | The menu bar says when the next meeting starts, so you stay focused on the current task. |
| Notion Calendar | [Product Hunt reviews](https://www.producthunt.com/products/cron/reviews) | Reviewers name the menu bar countdown and quick join links as favourites. One values watching the countdown "without interrupting my workflow". |
| Sunsama | [Official daily planning guide](https://sunsama.com/blog/the-official-daily-planning-guide) | Three steps: pick, decide what can wait, order. "Your day is not a project." "Planning to do less." |
| Sunsama | [Saner review](https://www.saner.ai/blogs/sunsama-reviews), [Asian Efficiency review](https://www.asianefficiency.com/schedule-management/sunsama-review/) | Reviewers report 10 to 20 minutes each morning, and warn that skipping a few days turns it into an app collecting dust. Third party opinions. |
| Superhuman | [The fastest email experience ever made](https://blog.superhuman.com/the-fastest-email-experience-ever-made/), [Inbox Zero help](https://help.superhuman.com/hc/en-us/articles/45295217605523-Achieve-Inbox-Zero) | Every action has a key, and a command bar covers the keys you do not know. The post gives no latency number, so I quote none. |
| Lead Studio | `polish-study.md` on branch `KineBeo/polish-study` | Lead shares its window with a file column, 9 clipped tabs and a terminal. It already beats Claude on honest waits, errors that keep work, one-button resume, and YOU CAN and IF YOU WAIT rows. |
| Spec | `proto/`, `proposal/data.js`, `proposal/wireframes.js` in the handoff folder | The 6-step loop, 6 cook steps, 40 wireframes. Spec numbers are real, so this prototype uses none of them. |
| Mascot | `documents/brand/mascot/index.html` | The 3D model is reused line for line: 9 expressions, 7 poses. |

## What works and why

1. **One answer on open.** Things Today and Notion Calendar's menu bar answer "what now" before you ask. A dashboard asks you to work that out.
2. **A fixed point in the day.** Calendar tools work because time is already ordered. A reel maker has one fixed point: tonight's post time.
3. **The way back to work is short.** Linear dims navigation so the task leads. Lead Studio's problem is the opposite: the shell leads and the task hides.
4. **One bar, one key.** Raycast's bottom bar puts the next action in the same place every time, so Return is safe to press without looking.
5. **Show the plan's size honestly.** Sunsama's workload counter and "planning to do less" fit Lead's own honest waits.

## What to refuse

- **A long morning ritual.** Sunsama's 10 to 20 minutes makes sense for knowledge work, but here Claude writes the plan. Kai's part is one okay. Target under one minute.
- **Streaks and red overdue counts.** Reviewers describe the habit as fragile. A skipped day must not leave a pile. Lead Studio has no overdue state in this prototype.
- **Everything on one dashboard.** The study shows Today repeats three other boards. Here Today carries no number tiles.
- **A blank search box as home.** Raycast's root search is right for someone who knows what they want. A morning opener has to say it first.
- **Speed claims without measurement.** The proof page reports the measured click to screen time, and nothing else about speed.
- **Claude's look.** No cream paper, no serif greeting, no chat box as the home.

## Strategy chosen: the day is a timeline

A reel maker already reads timelines. So Lead Studio's top edge is an edit track of the day: six clips, one per loop step, a playhead on what is happening now, and tonight's post as the last mark with a countdown. Under it sits one sentence and one next action on Return. Everything else is one key away.

Each state is drawn on the clip, so it reads at a glance: filling while running, running past the "usual" tick when slow, solid with a torn hatched end when stopped (finished work stays solid), hatched with a clock when limited, a dashed outline when empty or not reached yet.

## Rejected

| Alternative | Why it lost |
| --- | --- |
| Guided morning wizard, like Sunsama's flow | Strong on habit, but it costs minutes and it is fragile when skipped. Most days only one step needs Kai, so a wizard would walk him past steps with nothing to do. |
| Inbox to zero, like Superhuman or Linear Inbox | A clean list of things waiting on you, but it hides running work, and much of Lead's day is waiting on Claude. It also loses the post time, which is what the day is ordered by. |
