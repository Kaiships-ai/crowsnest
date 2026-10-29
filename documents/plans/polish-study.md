---
status: active
components: [shell, boards, cook-pane, connectors]
backlog: none
owner: null
shipped: null
---

# Polish study: Claude Desktop and Lead Studio

This study compares Claude Desktop 4.29 with the Lead Studio dev app across the same 8 moments, so Kai can pick how Lead Studio gets its own feel instead of an Orca look.
Kai's words for the target feel are Great, Creative, Smooth, Quick, Fast and Clean.
Nothing here is decided. Kai picks keep, cut or merge for each board and which ideas to build first.

The full story page is `polish-study/feel-study.html`, with every screenshot, frame and video beside it under `polish-study/web/`.
It holds the paired screenshots per moment, what Claude does, why it works, and what Lead Studio does instead, plus Keep / Cut / Merge buttons and a "Copy my picks" button.

## How it was captured

- Claude Desktop refuses to start when a debugging switch is on its command line, so it was shot with macOS `screencapture` and driven with real mouse and keyboard input. Its window is 1710x1074 and could not be resized.
- Lead Studio ran in dev mode through the verify skill lanes (fresh, empty, seeded boards lane with the fake sidecar, Umami and Polar), shot over CDP at 1440x900.
- The two Claude prompts went to an Incognito chat, so nothing was added to Kai's history.
- In the repo copy, Kai's chat titles, project and artifact names, account name and saved draft are covered by labeled boxes. Five Claude videos showed the draft and are left out; clean frames stand in for them.
- Gaps: Codex is not installed, so it is not in the study. The PublishSheet was not captured, because the Publish button needs a video attached over MCP. Lead timings come from stitched CDP frames and are weak.

## The 8 moments

| Moment | Claude | Lead Studio |
| --- | --- | --- |
| 01 First open | [claude](polish-study/web/claude/01-first-open.webp) | [lead](polish-study/web/lead/01-first-open.webp) |
| 02 Empty state | [claude](polish-study/web/claude/02-empty-state-c.webp) | [lead](polish-study/web/lead/02-empty-state.webp) |
| 03 Main job | [claude](polish-study/web/claude/03-main-job.webp) | [lead](polish-study/web/lead/03-main-job.webp) |
| 04 Long-running | [claude](polish-study/web/claude/04-long-running.webp) | [lead](polish-study/web/lead/04-long-running-b.webp) |
| 05 Error | [claude](polish-study/web/claude/05-error.webp) | [lead](polish-study/web/lead/05-error-b.webp) |
| 06 Settings | [claude](polish-study/web/claude/06-settings-connectors-yours.webp) | [lead](polish-study/web/lead/06-settings.webp) |
| 07 Navigation | [claude](polish-study/web/claude/07-navigation-a.webp) | [lead](polish-study/web/lead/07-navigation-b.webp) |
| 08 Animations | [claude video](polish-study/web/video/claude-08-stop-generation.mp4) | [lead video](polish-study/web/video/lead-08-switch-tabs.mp4) |

## Boards: keep, cut or merge

Each row gives the evidence for every option. Kai picks.

| Board | Shot | Overlap | Keep because | Cut because | Merge option |
| --- | --- | --- | --- | --- | --- |
| Today | [today](polish-study/web/lead/boards/today.webp) | Funnel strip repeats Funnel. Gate counts repeat Gate 1 and Gate 2. Last pulls repeats Sources. | The one place that gathers what waits for approval. | Repeats three other boards. Empty, it shows 8 dash tiles and no button. | Gate 1 and Gate 2 could fold into its approval block. |
| Funnel | [funnel](polish-study/web/lead/boards/funnel.webp) | Same 6 numbers as Today. The OWN01 row is My channel's "After the reel". | The only per-keyword split. Its subtitle promises a source and pull time for every number. | "no target set" on all 6 rows. Empty state names a tool call (`crowsnest_save_funnel`). | Into My channel, or My channel into Funnel. |
| My channel | [own](polish-study/web/lead/boards/own.webp) | "After the reel" matches Funnel's OWN01 row. Chart peak equals Reel views on Today. | The only view of Kai's own channel. The "Instagram pull failed" pill is direct. | Three tabs not captured yet. "1 posts" plural slip. Empty state has no title or button. | Into Funnel, or the reverse. |
| Rivals | [rivals](polish-study/web/lead/boards/rivals.webp) | The Outliers row repeats the Take card. "Pull rivals" lives in Sources. | Take, Learn and Avoid explain themselves. The best empty state in the app. | Outliers repeats Take. Long internal subtitle. | Outliers into Take, and move "Pull rivals" here. |
| Plan | [plan](polish-study/web/lead/boards/plan.webp) | Cook starts here, which leaves Studio empty. | The app's main job. The Plan card keeps the Cook pane's progress promise. | 7 Missing chips repeat 7 "not yet" rows. Month chips are clipped. | Nothing to merge into. Studio could merge into Plan. |
| Studio | [studio](polish-study/web/lead/boards/studio.webp) | Studio, Cook and "Studio Reel" name one place. | "Nothing is cooking. Cook a reel from Plan." is the best empty line in the app. | Empty in every capture. The real work happens in the Cook pane. | Into Plan, or into the Cook pane as a list of cooks. |
| Gate 1 | [gate](polish-study/web/lead/boards/gate.webp) | Count shows on Today. The diff repeats the 4 rows above it. | The subtitle teaches one skill. The approve button counts its changes. | The diff is a code editor. "Gate 1" is a code name. Not in the sidebar. | With Gate 2 as one review board, or into Today. |
| Gate 2 | [gate2](polish-study/web/lead/boards/gate2.webp) | Count shows on Today. Not in the sidebar. | The empty line points at the next step. | No title when empty. Only the empty state was captured. | With Gate 1 as one review board, or into Today. |
| Agents | [agents](polish-study/web/lead/boards/agents.webp) | Settings has an Agents page. Today has Running workspaces. | "Lead Studio never calls a model itself." builds trust. | Developer words (MCP, tokens, Journal). Setup work, not daily work. | Into Settings. |
| Cook pane | [cook-pane](polish-study/web/lead/boards/cook-pane.webp) | The Plan card shows the same progress. | Best copy and motion in the app: a named actor, step count, time against usual, kept work on failure. | Terminal and file tree shown by default. Paths, pid, frame 0. Video box says "No video yet" after the draft. | Studio could become its list. |
| Sources | [sources](polish-study/web/lead/boards/sources.webp) | Today's Last pulls repeats every state. "Pull rivals" for Rivals lives here. | Calm group line, "pulled on request, never on a timer." Honest long-pull and error states. | Could leave the sidebar and live only in Settings. | Into Settings, with states as a tick table like Claude's Connectors. |

## Three ideas to steal first

These are proposals. The sizes are guesses.

1. **One screen, one job.** Claude's canvas holds one main thing at a time. Lead boards share the window with Orca's file column, a strip of 9 clipped tabs, a developer "+" menu, the ORCA first screen and "Loading editor...". Hiding that shell while a board is open does the most to stop Lead looking like Orca. Serves Clean, Great and Quick. Size: medium. Evidence: [claude](polish-study/web/claude/03-main-job.webp), [lead](polish-study/web/lead/07-navigation-b.webp).
2. **Answer at once, then fill a reserved shape.** Claude answers each action where the eye is: the bubble shows on Enter, grey rows hold the page shape for about 0.4 s, new text fades in, and Settings opens in under 0.1 s. Lead shows blank frames then a spinner when Settings opens (about 1.2 s, weak measure), a "0 / 13" bar that sits still for at least 21 s, and hard text swaps in the Cook card. Serves Smooth, Quick and Fast. Size: small to medium. Evidence: [claude](polish-study/web/frames/claude-07-navigation/f05.webp), [lead](polish-study/web/lead/04-long-running.webp).
3. **Speak the reel maker's words.** Claude names things the way a user knows them and fences technical words into Developer settings. Lead's best lines already do this ("Nothing is cooking. Cook a reel from Plan."). The rest leaks code names (`crowsnest_save_funnel`, Gate 1, sidecar, session id, pid, frame 0) and plural slips ("missing 1 keywords", "1 posts"). One copy pass: plain words, one sentence and one or two verbs per error, a greeting of Lead's own on Today, and a YOU CAN row on Sources and the gates. Serves Great, Creative and Clean. Size: small. Evidence: [claude](polish-study/web/claude/05-error.webp), [lead](polish-study/web/lead/cook/cook-pane-pid-gone.webp).

## Where Lead Studio already does better

Keep these through any redesign. Lead tells the truth while waiting ("Taking longer than usual (2:00)... You can leave Settings; the pull keeps going."). Its errors keep finished work ("3 rivals have new numbers. The other 10 keep their older numbers."). One button resumes the rest ("Turn on and pull the rest (11)"). The Cook pane's YOU CAN and IF YOU WAIT rows have no Claude equivalent.
