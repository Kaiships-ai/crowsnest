# Weekly content plan, scored by funnel stage

A proposal for a weekly content plan format and the end-to-end machine that fills it,
built on top of what Crowsnest already does. The audience is one solo founder growing a
faceless short-form channel toward 100k followers, who runs his pipeline from Claude Code
and not from a dashboard.

This is a proposal, not code. It names the real Crowsnest tools and skills at each stage,
says honestly what exists versus what has to be built, and ends with the smallest version
that runs this week.

## What Crowsnest gives us to build on

Grounded in `docs/product-description/`, the MCP server at `src/server/mcp/mcp-server.ts`,
and the `cn-remix` skill. The parts that matter for a weekly funnel plan:

- The outlier feed. Scraped competitor posts, each with an `outlierScore` (views over that
  channel's own baseline, so a 9 means roughly 9x the channel's normal). This is the one
  real, machine-derived virality signal in the system. Exposed as `crowsnest_feed`.
- Per-video analysis. Hook type, structure beats, format and style tags, and a "why it
  worked" note. Exposed as `crowsnest_video`.
- The six-stage remix. Turns one outlier into a saved script and an undated draft planned
  post, with a human gate at every real choice. Driven by the `cn-remix` skill over the
  `crowsnest_remix_*` tools.
- The studio cook. Renders a planned post into a video. Briefed by `crowsnest_brief`.
- Own-channel metrics. Real published posts measured through the Graph API, in the
  `ownPosts` table, shown on the my channel page.

What Crowsnest does not have, and this proposal has to work around or ask for:

- No funnel classification anywhere. No post, video, or analysis is tagged top, middle, or
  bottom funnel. Nothing computes it.
- No weekly plan artifact. Planned posts are dated intentions, one row each; there is no
  object that groups a week and scores it.
- No ideas MCP tool. `crowsnest_plans` reads planned posts; there is no `crowsnest_ideas`.
- No closed publish loop. The mark-published action is broken (B-01: it writes a null id,
  so a plan never durably reads as published), and there is no path from the app to any
  network post.

## 1. The weekly plan table format

The plan is one table, five rows, produced once a week. Each row is one content concept
carried across all three funnel stages, so a single idea is planned as a top-funnel cut, a
middle-funnel cut, and a bottom-funnel cut. The founder reads the table, picks the row
with the best combined score (or the tool picks and states why), and drills into that row.

### Columns

| Column | What it holds |
| --- | --- |
| ID | Row number, 1 to 5. Stable within the week so the pick can name it. |
| Top funnel content | The reach cut of this concept: a one-line title plus a one-line hook idea. Made to be watched and shared by people who do not know the channel. |
| Middle funnel content | The trust cut: the same concept turned into something that earns a follow or a save. Teaches, proves, or shows a method. |
| Bottom funnel content | The conversion cut: the concept aimed at the one action the channel exists to drive (a link click, a signup, a product view, a DM). |
| Viral score | Three sub-scores, 0 to 10 each, one per funnel stage, written `Top: 9 Middle: 4 Bottom: 10`. Plus a one-line source, which outlier each cut remixes, so the score can be checked. |

The Viral score cell is deliberately three numbers, not one. A concept can be a strong
reach play and a weak conversion play at the same time, and the founder needs to see that
split to choose. A single blended number would hide exactly the tradeoff the funnel view
exists to expose.

### What the three funnel stages mean for a solo faceless creator

Funnel language is borrowed from marketing, so it needs a concrete definition for a
faceless channel where the "product" is often just the channel itself and eventually an
offer.

- Top funnel. Reach. The goal is a stranger watching to the end and sending it to one
  friend. Broad hook, low prior knowledge assumed, pattern-interrupt opening, a payoff that
  travels. Success metric is views and shares, not follows. Example shape: "The one setting
  that quietly drains your phone battery."
- Middle funnel. Trust and follow. The goal is the person who found you deciding you are
  worth following, or saving this for later. Assumes a little context, delivers a repeatable
  method or a proof, rewards the save. Success metric is follows per view and saves. Example
  shape: "The 3-step routine that doubled my battery life, save this."
- Bottom funnel. Conversion. The goal is a specific action toward the offer: click the
  link, join the list, view the product, DM a keyword. Assumes the viewer already trusts the
  channel. Explicit call to action, one action only. Success metric is the action, clicks or
  signups, not views. Example shape: "I put all of this in a free checklist, link in bio."

For a faceless channel with no offer yet, bottom funnel means the follow-with-intent action
(save, comment a keyword, join a waitlist) until there is a real product to sell.

### Scoring rubric, 0 to 10 per stage

Each cut is scored on the axis that its own funnel stage is judged by. The three stages do
not read the same evidence, because a reach cut and a conversion cut succeed at different
things.

Top funnel score, reads shareability.

| Band | Meaning | Evidence |
| --- | --- | --- |
| 9 to 10 | Proven viral shape | Source outlier `outlierScore` at or above 8, hook type is broad, recent |
| 6 to 8 | Strong reach shape | Source `outlierScore` 4 to 8, or a broad hook on a mid outlier |
| 3 to 5 | Niche reach | Source `outlierScore` 2 to 4, or a narrow hook |
| 0 to 2 | Unlikely to travel | No strong source outlier, inside-baseball topic |

Middle funnel score, reads follow-worthiness.

| Band | Meaning | Evidence |
| --- | --- | --- |
| 9 to 10 | Clear method with proof | Source analysis structure has a teachable sequence, "why it worked" cites value or utility |
| 6 to 8 | Useful, some proof | Analysis shows a listicle or how-to structure |
| 3 to 5 | Mildly useful | Entertainment-led source with a thin takeaway |
| 0 to 2 | Nothing to follow for | Pure spectacle, no method |

Bottom funnel score, reads conversion fit. This is the honest weak spot.

| Band | Meaning | Evidence |
| --- | --- | --- |
| 9 to 10 | Concept sits right next to the offer, natural CTA | Human judgment against the founder's actual offer |
| 6 to 8 | Adjacent to the offer | Human judgment |
| 3 to 5 | Loose link to the offer | Human judgment |
| 0 to 2 | No path to any action | Human judgment |

### Which scores are real today, and which are aspirational

Being honest about this is the point of the section.

- Top funnel score: derivable today. It reads almost entirely from `outlierScore` and the
  hook type in the analysis, both of which `crowsnest_feed` and `crowsnest_video` already
  return. This is the one score the machine can compute now with a real signal behind it.
- Middle funnel score: partly derivable. The analysis structure and "why it worked" note
  hint at whether a concept teaches something, but there is no field that says "this is a
  method." Today this is a heuristic read of existing analysis text, so it is machine
  assisted, not machine derived. Treat it as a draft the human confirms.
- Bottom funnel score: not derivable. Crowsnest has no representation of the founder's offer,
  so nothing in the data knows whether a concept converts. This score is a human input every
  week until an offer definition exists in the system. Do not fake it with a number the data
  cannot support.

So of the fifteen numbers in a five-row table, five (the top-funnel column) stand on a real
signal, five (middle) are a heuristic to confirm, and five (bottom) are human judgment. The
table should show which is which rather than present all fifteen as equally earned.

## 2. The row detail

When a row is picked, the detailed view for that row is what the founder reads before
committing a week of production. It is written for the one cut chosen from the row (usually
the highest sub-score), not all three at once.

The detail contains:

- Concept. One paragraph. What the video is about, in plain language.
- Funnel intent. Which stage this cut serves (top, middle, or bottom) and the single metric
  it is trying to move (shares, follows, or a specific action).
- Hook. The exact opening line or two, the thing that has to land in the first second.
- Angle. The specific take that makes this not a copy of the source: the twist, the
  contrarian framing, or the niche the founder owns.
- Strategy. Three parts, stated plainly:
  - Audience. Who this is for, specifically, not "everyone."
  - The action it moves them toward. The one thing you want the viewer to do next, matched
    to the funnel stage.
  - Why now. Why this concept this week: a trending outlier, a seasonal hook, a gap in the
    last few weeks of the channel.
- Source outlier. The competitor video this remixes: handle, url, `outlierScore`, view
  count, hook type, and the "why it worked" note. This is the provenance, and it is what the
  top-funnel score was read from, so it lets the founder sanity-check the number.

This maps cleanly onto what `cn-remix` already produces. The source outlier, hook, and
angle are exactly the inputs the remix session takes at its prompt and hook gates, and the
review file the skill writes at `docs/remix-reviews/{postId}.md` already carries the source,
the chosen hook, the beats, and a recommendation. The row detail is the plan-time version of
that review: the same fields, decided before the remix runs rather than after.

## 3. The end-to-end content machine, stage by stage

Each stage maps to a real MCP tool, a skill, or a manual step. Nothing here is invented; the
gaps (marked "to build") are called out as such and collected in section 4.

| Stage | What happens | Tool, skill, or manual |
| --- | --- | --- |
| Research and scan | Pull the week's top outliers, filtered by score, follower band, recency | `crowsnest_feed` (MCP), inspect with `crowsnest_video` |
| Weekly plan | Turn the scanned outliers into a five-row funnel table with scores | Manual today (Claude Code reads the feed and writes the table). To build: `crowsnest_ideas` MCP tool and a plan store |
| Pick | Choose the highest-scoring row, or the tool picks and states the reason | Manual, a human gate, same shape as the `cn-remix` pick gate |
| Remix to script | Turn the picked concept into a saved script and a draft planned post | `cn-remix` skill over `crowsnest_remix_*` (MCP), with its human gates and review file |
| Video | Render the script into a faceless explainer video | `faceless-explainer` skill via HyperFrames (`hyperframes` skill, render tools). Note: `render_video` is disabled for local CLI clients, so render through the local HyperFrames CLI skill, not the hosted MCP |
| Publish | Post to the own channel and record it as published | Manual today, and broken. `crowsnest_brief` feeds the cook, but mark-published is B-01. To build: a working close-loop |
| Measure | Read what the published post actually did on the own channel | Own-channel metrics on the my channel page (`ownPosts`). No MCP tool exposes these yet. To build: `crowsnest_metrics` read, and the loop back into next week's scores |

The through-line: research and remix are solid and already tool-backed. The two ends, the
weekly plan at the front and publish-plus-measure at the back, are where the machine is
still manual or broken.

## 4. The gaps

What must exist to run the weekly-funnel flow end to end, ranked by whether a gap blocks the
flow or merely improves it.

### Blocking, the flow cannot close without these

1. Publish close-loop and the B-01 fix. Today marking a post published writes a null id, so
   nothing durably reads as published (`docs/product-description/bug-triage.md`, B-01, high).
   Until this is fixed there is no closed loop: the machine can plan, remix, and render, but
   it cannot record that a post shipped, which means it cannot measure or learn. This is the
   single highest-value fix because it unblocks the entire back half. Related: B-08 and B-13,
   the same null-id problem showing up on the calendar and after a reload.
2. Funnel scoring. There is no funnel classification anywhere in Crowsnest. The whole plan
   format depends on scoring each concept top, middle, and bottom. Without at least the
   top-funnel score (derivable from `outlierScore` today) and a slot to hold the human middle
   and bottom scores, there is no table. This does not need to be a database migration on day
   one; it needs a defined place to write three numbers per concept.
3. A weekly-plan store or file. There is no object that groups a week of concepts and their
   scores. The plan has to live somewhere the founder and the tools can both read across the
   week. A markdown file under `docs/` is enough to start; a table comes later.

### Improving, the flow runs without these but is weaker

4. A `crowsnest_ideas` MCP tool. Right now Claude Code can read the feed and hand-write the
   plan. An ideas tool that returns scored concept candidates would make the weekly-plan stage
   one call instead of a manual synthesis, and would let the plan be regenerated cheaply. Nice,
   not required, for a first run.
5. A measurement feedback loop. Once publish is closed and `ownPosts` is readable, the loop
   that scores what actually worked (did the top-funnel cut actually get shared, did the
   bottom-funnel cut actually convert) should feed back into next week's scores, so the rubric
   stops being a guess and starts being calibrated against this channel. High value, but it
   depends on the blocking fixes landing first, so it cannot be the first thing built.
6. A `crowsnest_metrics` read tool. The my channel page shows own-post metrics, but no MCP
   tool exposes them, so Claude Code cannot read results without the dashboard. Needed for the
   feedback loop in item 5, and it is a thin wrapper over an existing query, the same pattern
   as every other read tool in `mcp-server.ts`.

## 5. Recommended first slice

The smallest version that runs this week, and does one real loop end to end without building
new infrastructure.

Run it as a weekly ritual inside Claude Code:

1. `crowsnest_feed` with a high `minScore` and `analyzed: "yes"`, pulling the week's top
   outliers. Inspect the best few with `crowsnest_video`.
2. Claude Code writes a five-row plan table to a plain markdown file at
   `docs/content-machine/weeks/{date}.md`. Top-funnel scores are read from `outlierScore`.
   Middle scores are a heuristic from the analysis structure. Bottom scores are left blank for
   the founder to fill against his offer. The table marks which numbers are derived and which
   are human.
3. The founder picks the best row (or Claude picks and states why).
4. Run `cn-remix` on that row's source outlier, straight through to a saved script and a
   draft planned post, with its existing human gates.
5. Render with `faceless-explainer`, then publish by hand and note the result in the same
   weekly file.

What this slice defers:

- The B-01 publish fix. The first slice records publishing by hand in the weekly file, which
  is honest about the fact that the app cannot durably mark a post published yet. It surfaces
  the pain without waiting on the fix.
- The `crowsnest_ideas` tool. The plan is hand-written by Claude reading the feed. Build the
  tool only once the manual ritual has proven the table format is right.
- The database plan store. A markdown file per week is the store. Move to a table when there
  are enough weeks to want to query across them.
- The measurement feedback loop. The first few weeks just record raw results next to each
  plan. Calibrating the rubric against them comes after there is data to calibrate against.

The one thing not to defer: writing down the bottom-funnel score by hand every week. It is
the score the data cannot give us, and it is the one that ties the whole plan to why the
channel exists. Skipping it turns the machine into a reach-only content mill, which is the
failure mode this funnel format is meant to prevent.
