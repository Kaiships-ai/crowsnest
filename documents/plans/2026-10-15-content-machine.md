---
status: active
components: [mine, mcp, publish]
backlog: none
owner: null
shipped: null
---

# Content machine plan

> **For agentic workers:** REQUIRED: run with `/poteto-mode`. One phase is one PR and must pass its check before the next starts. No code phase starts before Kai says go, and not before 2026-10-22 (no system building before then).

## Goal

Every post reaches done as defined in [0003](../decisions/0003-post-lifecycle.md): published, funnel tested with a second account, 48-hour numbers stored. Each phase replaces one manual step of the current weekly routine and is usable the week it lands. Nothing in the routine is rebuilt from scratch.

## Decisions in force

| Question | Answer |
| --- | --- |
| What to sell for the next 4 weeks | The Reel Kit at $29.99. The $99 crowsnest Kit is on hold. |
| Where leads go | Skool, free. The website only sells. |
| How source reels are ranked | By views, against the channel median. |
| Hook bar | 7 for a reel built from a proven template, 8 for a new format. |
| Where Kai reviews the week | The existing `plan.html` gate page in kaiship-business. No new crowsnest UI. |

## Phase 0: align the routine (no crowsnest code)

Kai's steps:

- [ ] Refresh the Graph token (`ig_publish.py refresh`), then set it in crowsnest Settings.
- [ ] Test the open DM flows with the second account, one per day.

Agent steps, in kaiship-business:

- [ ] Fill the empty 48-hour columns with `ksa_sync.py --fill-48h` once the token works.
- [ ] Add a `funnel_test` column to `posts.csv` (tested date or empty).
- [ ] Point `ksa-ig-magnet` at Skool, as the CREW flow already does.
- [ ] Rank by views in `ksa-content-plan`.
- [ ] Write the hook bar into the review step.
- [ ] Add `assets/kai` to the handdrawn reel template so new reels stop copying it.

Check: one reel posted this week has all three parts of done in `posts.csv`.

## Phase 1: measurement failure is visible

A Graph auth error today only writes `graph.request.error` log rows. Surface it in the shell failure strip and in `crowsnest_ig_status`, naming the token.

Check: with an expired token, the dashboard and the MCP status both say the token is the problem.

## Phase 2: the post record and its MCP write path

Add the funnel test field to `planned_posts` and one MCP tool that creates or updates a post (title, date, source video, script, permalink, funnel test). Match a published permalink to `own_posts` so `publishedOwnPostId` fills itself. Import the existing `posts.csv` rows once.

Check: an agent creates a post over MCP, the reel is published, and the post shows its 48-hour numbers with no hand edit.

## Phase 3: the routine reads and writes crowsnest

Switch `ksa-content-plan`, `ksa-review` and `ksa-ig-magnet` from `posts.csv` to the Phase 2 tools. Retire the sheet's write path when the skills no longer touch it.

Check: a full week runs with `posts.csv` untouched and every post's state readable from crowsnest.
