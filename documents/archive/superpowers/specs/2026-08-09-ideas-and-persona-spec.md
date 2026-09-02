# Ideas, persona, and feed polish spec, 2026-08-09

Derived from the Sandcastles v3 UI backlog (docs/research/2026-08-08-sandcastles-ui-backlog.md) and a
grilling session on 2026-08-09. Every decision below was confirmed with Kai. This spec covers the
slice we agreed to build. It does not cover the parked items (B3 channel discovery, B9 automations, B6
exports, B4 projects), which wait on the IG sidecar and on Ideas landing first.

## Goal

Make the daily loop real: open the app, triage a queue of ideas built from outliers, ship one or two
scripts that sound like Kai by default. B7 and B8 are the warm-up. B1, B2, and B5 are the loop.

## Domain model

Three schema changes. All additive.

### Idea (new table)

One idea per analyzed video. A short concept plus an angle, generated from the existing
`video_analyses` row, then triaged.

Columns:
- `id` text, primary key
- `source_video_id` text, references videos(id)
- `concept` text, the one-line hook of the idea
- `angle` text, a short paragraph on how to take it
- `status` text, one of inbox, shortlisted, scripted, discarded. Default inbox.
- `notes` text, nullable, the user's own note on this idea
- `score_at_creation` real, the video's outlier score when the idea was made, so the inbox can sort by
  it without a join that changes under later syncs
- `remix_session_id` text, nullable, set when status becomes scripted
- `created_at`, `updated_at` text

Invariants:
- At most one non-discarded idea per source video. A second generation on the same video updates the
  existing idea rather than making a duplicate (same shape as `upsertVideo` keyed on external id).
- Discard is soft. A discarded idea keeps its row and can return to inbox. This matches the
  soft-delete pattern the sync engine already uses, and it means "Discard all" is reversible.
- Deleting a source video (soft) does not delete its idea. The idea keeps the concept text, which is
  the part worth keeping, and shows the source as gone.

### Persona (single row)

One persona for the whole app. Kai is solo, one brand. Stored either as a new `persona` table with a
single row or as structured keys in `app_settings`. Recommend a small `persona` table for clean typing.

Columns: `audience`, `voice`, `do`, `dont`, `updated_at`.

- Seed `audience` from the current niche-profile setting ("AI tools and building-in-public for solo
  founders"). Leave `voice`, `do`, `dont` empty for Kai to fill.
- Every generation reads the persona: idea concept, hook options, script. Not a toggle. The niche
  textarea in Settings is replaced by a link to the Persona surface.

### video_analyses.summary (new column)

- `summary` text, nullable. A one-paragraph plain summary of the video.
- Written once, at analyze time, alongside the existing tag extraction. Never computed per page view.
- Backfill is not required. Videos analyzed before this column stay null and show no summary until
  re-analyzed.

## Units

Build order top to bottom.

### U1 Video detail summary and word count (B7). Size S.

- Show the `video_analyses.summary` paragraph above the tab row on video detail. If null, show nothing
  (no empty block).
- Add a word count on the Transcript tab label, computed from the stored transcript.
- The Idea Analysis tab is deferred to U4, since it is the front end of the ideas feature. Do not add
  an empty tab now.

Acceptance: a video analyzed after this ships shows a summary and a transcript word count. A video
analyzed before it shows neither, and nothing is broken.

### U2 Feed filters: engagement and analyzed status (B8). Size S.

- Add an engagement-rate filter to the feed toolbar. The rate is already shown on cards, so this
  filters an existing number.
- Add a status filter with Analyzed and Unanalyzed, where analyzed means a `video_analyses` row exists
  for the video.
- Surface the existing `importSingleReel` as an Add video URL action on the feed toolbar. Reuse the
  path, do not add a second import.

Acceptance: filtering by engagement narrows the grid, the Analyzed filter shows only videos with an
analysis, and Add video URL imports one reel the same way the add-channel dialog does today.

### U3 Persona surface (B5). Size S to M.

- A new Persona page under Setup, holding audience, voice, do, and do-not.
- On first load, audience is pre-filled from the old niche-profile value.
- Wire the persona into the generation prompts that today read the niche profile (Remix, and the idea
  generator in U4).
- Replace the Settings niche-profile textarea with a short line linking to Persona.

Acceptance: saving a persona changes the next generation's output. The old niche text is not lost.

### U4 Idea generation and the Ideas inbox (B1). Size L.

Generation:
- One function: given a video that has a `video_analyses` row, produce `{ concept, angle }` in a single
  LLM call that reads the analysis and the persona. Upsert the idea keyed on source video.
- Auto pass: after a sync finishes scoring, take new outliers with score at or above 3x, top 20 by
  score, that already have an analysis, and generate ideas for them. Paced and cancelable, and it
  yields to a sync the same way the enrichment and backfill passes do. Runs on the free local 9router,
  so cost is not the limit; the cap and threshold are the limit.
- Manual: a Generate idea action on any analyzed video.

Dependency to confirm before building the auto pass: ideas need an analysis, and a brand-new outlier
from a sync is usually not analyzed yet (analysis is on-demand and needs the video downloaded first).
So the auto pass only covers already-analyzed outliers. Ideas on fresh, unanalyzed outliers would need
a download-transcribe-analyze chain pulled into the pass, which is a real cost and a v2 decision, not
part of this unit.

Inbox UI:
- A new Ideas item under Research in the nav, with a pending count (ideas in inbox status).
- Two tabs, Inbox and Shortlist. A list of idea cards on the left (concept, source thumbnail, outlier
  and view badges), the selected idea on the right (concept, angle, source video, a notes field).
- Actions: Create script, Shortlist, Discard, and a Discard all on the inbox.
- Create script opens the existing Remix flow with a `remix_sessions` row seeded from the idea
  (`source_video_id` set, `topic` set from the concept), and moves the idea to scripted with its
  `remix_session_id` recorded.

Acceptance: a sync produces ideas in the inbox, each triages to shortlist or discard, discard is
reversible, and Create script lands in Remix already carrying the concept and the source video.

### U5 Keyboard command menu (B2). Size M.

- A command menu, context-aware by what it sits on, one key per action.
- On an idea: Create script C, Shortlist S, Add to project A, Save hook template H, Export for LLM E,
  Open in new tab O, Discard D. Navigation with the arrow keys and Esc.
- On a vault item: Remove from vault R.
- Export for LLM reuses the existing export path (export.ts, the same block as Copy as prompt), widened
  to carry concept, hook, structure, and persona. Open in new tab opens the detail route. Neither is a
  new subsystem.
- Add to project appears only once Projects exists (parked). Save hook template needs the Vault save
  action. Until each backing feature lands, its menu row is hidden, not shown-and-broken.
- Build it on the Ideas inbox first, where triage speed is the point. Reuse on video detail later.

Acceptance: the whole inbox triage runs from the keyboard without the mouse, and Export for LLM yields
the same paste-ready block the menu and the video detail both produce.

### U6 Local MCP server (new). Size M to L.

A local stdio MCP server that exposes Crowsnest's research as tools, so Claude (in Claude Code or the
desktop app) reads outliers and analyses without leaving the chat. This is where the daily loop meets
the tool Kai already works in.

- Transport: local stdio. Reads the same SQLite DB through a read-only better-sqlite3 connection, so it
  does not need the Next server running. Open the connection WAL-safe (the cp-drops-the-WAL lesson: a
  read connection is fine, a naive copy is not).
- Reuses the query layer (queries/feed.ts, similar.ts), so each tool is thin.

v1 tools, read-only:
- search_outliers, filters for score, views, engagement, channel, timeframe
- get_video, stats plus analysis plus transcript for one post
- get_similar, the existing similar-outliers ranking
- list_ideas, inbox and shortlist with concept and angle
- get_persona
- export_for_llm, the same paste-ready block as U5's Export for LLM

Write tools (create an idea, trigger a sync, generate a script) are deferred. They mutate and spend
LLM calls, and read-first keeps v1 safe.

Priority split: search_outliers, get_video, and get_similar run over data that already exists, so they
can ship early, independent of the ideas work. list_ideas and get_persona wait for U4 and U3.

Acceptance: Claude Code connects to the server and can search outliers, open one post's full analysis,
and pull the same LLM export block the app produces, all read-only.

## Sequencing and dependencies

1. U1 and U2 first. Small, visible, no new infra, no dependency on each other.
2. U3 Persona before U4, because the idea generator reads the persona.
3. U4 Ideas, the center of gravity.
4. U5 keyboard menu on top of the inbox.
5. U6 MCP runs on its own track. The three read tools over existing data (search_outliers, get_video,
   get_similar) can ship any time, even before U1. Its idea and persona tools wait for U4 and U3.

## Parked, and why

- B3 channel discovery (Suggested, Describe) and B9 automations both lean on the IG sidecar, which
  currently returns HTTP 503 on every profile lookup. Fix the sidecar first or they stall like
  add-channel does now.
- B4 Projects waits until ideas exist, since Add to project has nothing to hold without them.
- B6 Exports is thin and can follow Projects.

## Open decisions

- U4 auto pass numbers: threshold 3x and cap 20 per sync are a guess at Kai's volume. Adjustable in
  the same place as the other sync knobs.
- U4 dependency: whether to later pull analysis into the auto pass so brand-new outliers get ideas
  without a manual analyze step. Cost and sync-shape decision, deferred.
- Persona storage: a `persona` table versus keys in `app_settings`. Recommend the table.
