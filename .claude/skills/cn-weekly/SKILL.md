---
name: cn-weekly
description: >
  Build a weekly content plan for the Crowsnest channel from Claude Code: pull the
  week's top outliers, turn them into a five-row funnel table (top, middle, bottom
  funnel videos, each scored), pick the strongest row, write the row's strategy, then
  hand off to cn-remix. Grounds the funnel table in real outlier scores and marks
  which numbers are machine-derived versus human.
  3 phases, 2 human gates.
  Trigger: /cn-weekly
---

# Crowsnest weekly content plan (cn-weekly)

Turn the week's outliers into a scored five-row funnel plan, pick one row with a real strategy behind it, and hand it to `cn-remix`. This produces the plan and the pick. The script, the video, and publishing are the next steps.

The three funnel stages are defined by outcome (top gets views, middle gets followers, bottom gets leads), from the reel breakdown at instagram.com/reel/DVvlIBlDT6t. The broader content-machine context is in `docs/content-machine/weekly-plan-proposal.md`, but the stage definitions and the table model here are the corrected version and supersede that doc's earlier take.

## Before you start

- Run the `crowsnest-up` skill first (the 9router proxy, the dev server on localhost:3000, and the browser). The `crowsnest_*` MCP tools come from the dev server.
- Have the channel's offer in mind. The bottom-funnel score is a human judgment against the offer; Crowsnest has no model of it.

## What the three funnel stages are

Defined by outcome, not by format. Each stage is its own set of content types, and a week is a mix of all three. Which stage you weight depends on the goal right now.

- Top of funnel: gets views. Broad, shareable content for people who do not know the channel. Highest reach. Content types: ranking videos, storytelling (personal or business wins, losses, experiences), personal before and after transformations, tier list videos.
- Middle of funnel: gets followers. Value that earns a follow from someone who just found the channel. Content types: in-depth step-by-step tutorials, client or customer before and after transformations, Q and A videos, educational one-off tips and hacks.
- Bottom of funnel: gets leads. Authority and proof that turns a follower into a lead. Lowest reach, but it converts. Content types: big case study videos (what you would do for a big celeb or business), educational comparisons, "what I would do in this situation" case studies.

A row is not one idea recut three ways. It is one theme with three different videos, one per stage, each using a content type from that stage's menu. Want reach, weight top; want followers, weight middle; want leads, weight bottom.

## Inputs

- Week window: default `sinceDays: 7`. The recent outliers to plan from.
- Feed filters: a high `minScore` and `analyzed: "yes"`, so every row has a real "why it worked". Widen only if too few rows come back.
- The offer, from the user, for the bottom-funnel score.

## Output

A weekly plan file at `docs/content-machine/weeks/{YYYY-MM-DD}.md`: a five-row table, a legend marking which scores are derived versus human, then a strategy section for the picked cell.

Each row is a theme. Its three cells are three different videos for that theme, one per funnel stage, each using a content type from that stage's menu. The scores read each cell against what its stage is for: views, followers, or leads.

```
# Week of {date}

| ID | Theme | Top funnel video (views) | Middle funnel video (followers) | Bottom funnel video (leads) | Scores |
| --- | --- | --- | --- | --- | --- |
| 1 | the theme | reach video: type + hook | follower video: type + hook | leads video: type + hook | Views: 9 Followers: 4 Leads: (human) - src @handle 9.1x |
| ... five rows ... |

Legend: Views scores are read from the source outlier score (real). Followers
scores are a heuristic read of the analysis (confirm by eye). Leads scores are
human judgment against the offer; blank until you fill them. The content type in
each cell comes from that stage's menu.

## Picked: row {n}, {stage} video
(strategy section, written in phase 2)
```

No video, no schedule, no publish. Those are separate steps.

## Phase 1: Build the weekly board (HUMAN GATE)

### 1a: Pull the week's outliers

- `crowsnest_feed` with `sinceDays: 7`, a high `minScore`, `analyzed: "yes"`, `sort: "score"`.
- Inspect the strongest few with `crowsnest_video` for hook type, structure, and the "why it worked" note.
- Optionally pull the ideas inbox with `crowsnest_ideas` to seed concepts the user already saved, and `crowsnest_metrics` to see what the own channel recently did (so a concept can fill a gap).

### 1b: Synthesize five themes

- Group the outliers into five themes. For each theme, propose three different videos, one per funnel stage, each using a content type from that stage's menu: a top-funnel reach video (for views), a middle-funnel follower video, and a bottom-funnel leads video. Three different videos per theme, not one idea recut.

### 1c: Score and write the table

- Score each cell against what its stage is for, 0 to 10:
  - Top funnel (views): 9 to 10 if the source outlier score is 8 or above with a broad hook; 6 to 8 for score 4 to 8; 3 to 5 for a narrow hook or score 2 to 4; 0 to 2 if nothing travels. Read from the outlier score. This is the real number.
  - Middle funnel (followers): high if the analysis shows a teachable method, a tutorial, a Q and A, or a before and after; low for pure spectacle. A heuristic read of the analysis, so mark it to confirm.
  - Bottom funnel (leads): high only if the video is a case study, a comparison, or an authority piece that sits next to the offer. Human judgment. Leave blank as `(human)` until the user fills it.
- Write the file at `docs/content-machine/weeks/{date}.md` with the table and the legend. Name the source outlier per row so the views score can be checked.
- Also persist the plan into crowsnest as the source of truth, so it is queryable over MCP and shows in the dashboard's content pipeline: `crowsnest_save_artifact(kind: "monthly_plan", title: "Week of {date}", data: { rows, legend, pickedRow }, agent: "claude", sourceVideoIds: [the row source outlier ids], assumptions: "which scores are derived vs human")`. The markdown file is for the human to read; the artifact is the durable, provenance-stamped record.

### 1d: Pick a row (HUMAN GATE)

- Present the table. Recommend the row with the strongest combined score, and say why (usually a high top score plus a real middle or bottom path, not top alone).
- Wait for the user to pick a row and a stage (top, middle, or bottom). Do not run production on a reach-only pick without saying so.

## Phase 2: Detail and strategy (HUMAN GATE)

### 2a: Write the row's strategy

For the picked video (its stage), write into the weekly file:

- Concept: one paragraph, what the video is about.
- Funnel intent: the stage and the single metric it moves (views, followers, or leads).
- Hook: the exact opening line or two.
- Angle: the take that makes it not a copy of the source (the twist, the niche you own).
- Strategy: audience (specific, not everyone), the action it moves them toward, and why now (a trending outlier, a seasonal hook, a gap in recent weeks).
- Source outlier: handle, url, outlier score, views, hook type, why it worked. The provenance the top score was read from.

### 2b: Confirm (HUMAN GATE)

- Present the strategy. Wait for the user to approve it before any production. If they change the angle or the stage, update the file.

## Phase 3: Hand off to cn-remix

- Run `cn-remix` on the picked row's source video id, straight through its own gates and review file.
- Record the resulting `scriptId` and `postId` back in the weekly file next to the picked row, so the week's plan and its output stay together.

## Error handling

- Too few analyzed outliers for five rows: lower `minScore` or widen `sinceDays`, or allow unanalyzed rows and mark their middle score as "analyze first".
- The user has no offer defined: leave every bottom-funnel score `(human)` and say plainly the plan is reach-and-trust only until an offer exists.
- The user rejects the pick or the strategy: adjust and re-present. Do not proceed past a gate.
- Do not invent bottom-funnel numbers. A number the data cannot support is worse than a blank.

## Quick reference

| Phase | Does what | Human gate | Output |
| --- | --- | --- | --- |
| 1a. Pull outliers | crowsnest_feed, crowsnest_video | No | the week's outliers |
| 1b. Synthesize | five themes, three videos each | No | five rows |
| 1c. Score and write | rubric per stage, write the file | No | the weekly table |
| 1d. Pick | recommend and choose a row | Yes, pick the row and stage | chosen row |
| 2. Strategy | concept, hook, angle, strategy | Yes, approve the strategy | the row detail |
| 3. Hand off | run cn-remix on the source | (cn-remix's own gates) | scriptId, postId |

Total: 3 phases, 2 human gates (pick, strategy), then cn-remix takes over.
