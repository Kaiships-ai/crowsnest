---
name: cn-weekly
description: >
  Build a weekly content plan for the Crowsnest channel from Claude Code: pull the
  week's top outliers, turn them into a five-row funnel table (top, middle, bottom
  funnel cuts, each scored), pick the strongest row, write the row's strategy, then
  hand off to cn-remix. Grounds the funnel table in real outlier scores and marks
  which numbers are machine-derived versus human.
  3 phases, 2 human gates.
  Trigger: /cn-weekly
---

# Crowsnest weekly content plan (cn-weekly)

Turn the week's outliers into a scored five-row funnel plan, pick one row with a real strategy behind it, and hand it to `cn-remix`. This produces the plan and the pick. The script, the video, and publishing are the next steps.

The format and the scoring rubric come from `docs/content-machine/weekly-plan-proposal.md`. Read it once for the full rubric; the essentials are inline below.

## Before you start

- Run the `crowsnest-up` skill first (the 9router proxy, the dev server on localhost:3000, and the browser). The `crowsnest_*` MCP tools come from the dev server.
- Have the channel's offer in mind. The bottom-funnel score is a human judgment against the offer; Crowsnest has no model of it.

## Inputs

- Week window: default `sinceDays: 7`. The recent outliers to plan from.
- Feed filters: a high `minScore` and `analyzed: "yes"`, so every row has a real "why it worked". Widen only if too few rows come back.
- The offer, from the user, for the bottom-funnel score.

## Output

A weekly plan file at `docs/content-machine/weeks/{YYYY-MM-DD}.md`: a five-row funnel table, a legend marking which scores are derived versus human, then a strategy section for the picked row.

```
# Week of {date}

| ID | Top funnel content | Middle funnel content | Bottom funnel content | Viral score |
| --- | --- | --- | --- | --- |
| 1 | reach cut: title + hook | trust cut: the method | conversion cut: the action | Top: 9 Middle: 4 Bottom: (human) - src @handle 9.1x |
| ... five rows ... |

Legend: Top scores are read from the source outlier score (real). Middle scores
are a heuristic read of the analysis (confirm by eye). Bottom scores are human
judgment against the offer; blank until you fill them.

## Picked: row {n}, {cut} cut
(strategy section, written in phase 2)
```

## Phase 1: Build the weekly board (HUMAN GATE)

### 1a: Pull the week's outliers

- `crowsnest_feed` with `sinceDays: 7`, a high `minScore`, `analyzed: "yes"`, `sort: "score"`.
- Inspect the strongest few with `crowsnest_video` for hook type, structure, and the "why it worked" note.
- Optionally pull the ideas inbox with `crowsnest_ideas` to seed concepts the user already saved, and `crowsnest_metrics` to see what the own channel recently did (so a concept can fill a gap).

### 1b: Synthesize five concepts

- Group the outliers into five distinct content concepts. Each concept becomes one row, carried across three funnel cuts: a top-funnel reach cut, a middle-funnel trust cut, and a bottom-funnel conversion cut. One concept, three ways to make it.

### 1c: Score and write the table

- Score each cut 0 to 10 on its own axis:
  - Top funnel (shareability): 9 to 10 if the source outlier score is 8 or above with a broad hook; 6 to 8 for score 4 to 8; 3 to 5 for a narrow hook or score 2 to 4; 0 to 2 if nothing travels. Read from the outlier score. This is the real number.
  - Middle funnel (follow-worthiness): high if the analysis shows a teachable method or a clear how-to; low for pure spectacle. A heuristic read of the analysis, so mark it to confirm.
  - Bottom funnel (conversion fit): high only if the concept sits next to the offer with a natural call to action. Human judgment. Leave blank as `(human)` until the user fills it.
- Write the file at `docs/content-machine/weeks/{date}.md` with the table and the legend. Name the source outlier per row so the top score can be checked.

### 1d: Pick a row (HUMAN GATE)

- Present the table. Recommend the row with the strongest combined score, and say why (usually a high top score plus a real middle or bottom path, not top alone).
- Wait for the user to pick a row and a cut (top, middle, or bottom). Do not run production on a reach-only pick without saying so.

## Phase 2: Detail and strategy (HUMAN GATE)

### 2a: Write the row's strategy

For the picked cut, write into the weekly file:

- Concept: one paragraph, what the video is about.
- Funnel intent: the stage and the single metric it moves (shares, follows, or a specific action).
- Hook: the exact opening line or two.
- Angle: the take that makes it not a copy of the source (the twist, the niche you own).
- Strategy: audience (specific, not everyone), the action it moves them toward, and why now (a trending outlier, a seasonal hook, a gap in recent weeks).
- Source outlier: handle, url, outlier score, views, hook type, why it worked. The provenance the top score was read from.

### 2b: Confirm (HUMAN GATE)

- Present the strategy. Wait for the user to approve it before any production. If they change the angle or the cut, update the file.

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
| 1b. Synthesize | five concepts, three cuts each | No | five rows |
| 1c. Score and write | rubric per cut, write the file | No | the weekly table |
| 1d. Pick | recommend and choose a row | Yes, pick the row and cut | chosen row |
| 2. Strategy | concept, hook, angle, strategy | Yes, approve the strategy | the row detail |
| 3. Hand off | run cn-remix on the source | (cn-remix's own gates) | scriptId, postId |

Total: 3 phases, 2 human gates (pick, strategy), then cn-remix takes over.
