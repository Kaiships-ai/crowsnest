# Research: Lead Studio as a supervised agent app

Lens: products where a person approves and steers long-running AI work instead of operating it. How strong each source is matters here, so each one is labelled. "Read" means I opened the page. "Snippet" means I only saw search-result text because the page refused the fetch.

## What I looked at

| Source | Strength | What it gave |
| --- | --- | --- |
| [Anthropic, Measuring AI agent autonomy in practice](https://www.anthropic.com/research/measuring-agent-autonomy) | Read, primary | Full auto-approve goes from about 20% of sessions for new users to over 40% at 750 sessions. Interrupts go up as well, from about 5% to about 9% of turns. The authors read this as active monitoring: "effective oversight doesn't require approving every action but being in a position to intervene when it matters." They recommend trustworthy visibility and simple ways to redirect. |
| [Zhou et al., When Should Users Check?](https://arxiv.org/abs/2510.05307) | Read abstract, primary | 48 people monitored agents. 81% preferred confirmation during a task over confirmation at the end, and completion time fell 13.54%. One lab study, not a product result. |
| [Cursor 3 announcement](https://cursor.com/blog/cursor-3) | Read, vendor | All agents in one sidebar. "Engineers are still micromanaging individual agents." Goal: "a higher level of abstraction, with the ability to dig deeper when you want." "Cloud agents produce demos and screenshots of their work for you to verify." |
| [Cursor forum on the Agents Window](https://forum.cursor.com/t/when-using-agents-window-should-approve-undo-diffs-be-visible-and-actionable-in-the-files-tab-and-other-questions/160526.md) | Snippet, user thread | Review there is by file with a Review button, not per-change approve and undo. Users were asking where the old controls went. |
| [Devin session tools docs](https://docs.devin.ai/work-with-devin/devin-session-tools) | Read, vendor | One Progress view of all activity, jump to any earlier point, a `/btw` side chat that does not interrupt the work, stop the session to take over, and "tell Devin what you changed" on resume. |
| [Devin interactive planning docs](https://docs.devin.ai/work-with-devin/interactive-planning) | Snippet, vendor | A plan with a "Wait for my approval" choice for complex tasks. My direct fetch returned a different page, so I rely on the search text. |
| [OpenAI help page on ChatGPT agent](https://help-lb.openai.com/en/articles/11752874-chatgpt-agent) | Snippet, vendor | Says the agent is no longer available and points to ChatGPT Work. Describes pausing for login and "Take over browser". |
| [ITPro on ChatGPT agent](https://www.itpro.com/technology/artificial-intelligence/everything-you-need-to-know-about-openais-new-agent-for-chatgpt-including-how-to-access-it-and-what-it-can-do) | Snippet, press quoting OpenAI | Asks permission before actions of consequence, can be interrupted or taken over at any point, narrates what it is doing. |
| [MIT Technology Review on Manus, syndicated](https://pipedot.org/6VVS4) | Snippet, press | The live "Manus's Computer" window lets you watch and step in. Sessions can be replayed and shared. |
| Manus review blogs, seen in one search, no single page pinned | Snippet, weak | One review calls credits you cannot predict before a task the most common complaint. Blog-level evidence. |
| [Changkun Ou on human in the loop](https://changkun.de/blog/ideas/human-in-the-loop-agents/) | Read, secondary | Sort actions by whether they can be undone, not by abstract risk. Treats approval fatigue as a safety problem. I did not check the papers it cites. |

Also read: the polish study page and table, the Lead Studio spec files, the mascot page, the real copy in the Cook pane state code, and the `hallmark` and `emil-design-eng` skills.

Gaps I could not close. I found no user study of Manus replay, no hands-on account of Devin's waiting behavior, and could not open OpenAI's own launch post. Nothing below depends on those.

## What works and why

1. **Oversight is being able to step in, not clicking approve on everything.** Anthropic's numbers show people move there by themselves with experience. So the app should show the work and offer a cheap way in, and spend approvals only where they matter.
2. **Ask at the points that can't be undone.** Zhou et al. and the reversibility argument agree. For a reel maker that is two moments: changing the plan and posting. The product already has those two. Everything else should just run.
3. **Proof beats logs.** Cursor shows a demo and screenshots. A reel maker should see the reel, not a terminal, and every finished step should leave something to look at.
4. **Narration in one sentence.** ChatGPT agent narrates. Lead's Cook card already names an actor and a step. One plain line lets you stop reading the rest.
5. **Steer without stopping.** Devin's side chat and ChatGPT's interrupt both let you speak mid-run. What none of the sources I read describe is what happens to your note afterwards, so you can't tell whether it landed.
6. **A real way to take the wheel, with memory.** Devin's take over ends with "tell it what you changed". That handback is the part worth keeping. Keep the raw screen as the last resort, one click away.
7. **Say the cost before the wait.** The Manus complaint is about credits, but the shape is general: people want to know what they are in for. Lead's "usually about 3:00" already does it.

## What Lead already does better

Honest long waits, errors that keep finished work, one-button resume, YOU CAN and IF YOU WAIT rows. None of the agent products I read describe a row that says what happens if you do nothing. I built the whole app around that row.

## What to refuse

- **Approve-every-step prompts.** Fatigue turns them into a rubber stamp.
- **A live screen as the default view.** Watching Manus scroll is fun once. It is not what a reel maker came for.
- **The code diff at the plan step.** Reel makers compare reels, not lines.
- **A percent bar on work that has no percent.** The final render reports none, so it stays "so far, usually about".
- **Agent cards with fake confidence scores.** I have no honest number to put there.
- **Chat as the home screen.** It would recreate Claude, and it puts the burden back on the person to ask.
- **Mascot chatter.** It reports state in one line. It never congratulates you for clicking.

## Strategy chosen: the Line

The whole app is one production line across the top of the window. Six stations, four that run by themselves as circles, two that need a person as diamonds. Each reel is a bead moving along it, and the mascot sits on the line where the work is. Below the line, the home screen ("Desk") holds only what needs you, sorted by what is stuck, and tells you when you will next be needed, so you can leave.

New for this product, as far as the sources I read show:

- **Next-need forecast.** "Nothing needs you until about 14:20." It is the line that lets a person walk away. It is an estimate from usual times and says so with "about".
- **Note receipts.** A steering note shows sent, read, and what Claude did about it.
- **Answer in place.** Claude's question comes to the Desk with its choices as buttons, instead of "waiting for you in the terminal".
- **The mascot as watcher.** It watches Claude for you, and its pose is readable from across the room.

## Alternatives rejected

1. **Agent inbox.** A mail-style list of runs and requests, like Cursor's sidebar. Strong for many parallel agents, but one reel maker runs a few reels, so it would look empty most of the time and hide the loop. It also says nothing about the order of the work.
2. **Live cockpit.** A big live view of Claude's screen with a chat on the side, like Manus. Most exciting in a demo, but it asks the person to watch, which is the job this product is meant to remove. It also keeps the Orca look, because the terminal stays in front.
