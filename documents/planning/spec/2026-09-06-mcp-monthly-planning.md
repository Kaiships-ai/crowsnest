# Spec: MCP monthly and weekly content planning

Status: approved design, pre-plan

## Goal

Let an MCP client (Claude or Codex) drive crowsnest end to end to produce a realistic
monthly Instagram content plan and a weekly refresh, so the human's work collapses to
recording on the weekend, producing with the agents, then publishing and adjusting on
weekdays. Crowsnest stays the signal; the agent is the brain; the human decides.

This is items 2, 3, and 4a of the backlog, enhancing the existing `mcp` component. Item 5
(multi-account sharded sync) and item 4b (retiring the in-app Analyze UI and auto-analyze)
are out of scope here.

## The user's job to be done

- Output: a month of content mapped at a high level (a content-type ratio such as 4 broad,
  2 medium, 1 narrow), plus a weekly plan that can change fast when a big social event lands
  (a model launch, for example), each post carrying a brief and a video type.
- The taxonomy (broad, medium, narrow) and the ratio live in the agent's reasoning and the
  human's decision, not in a crowsnest column. Crowsnest serves signal; it does not model
  content type.
- The plan itself is a markdown document the agent writes and the human keeps (plan A).
  Crowsnest stores only the individual dated intents as `planned_posts`. A first class
  `content_plan` artifact stored in crowsnest is the long term goal (plan B), deferred.

## The loop

1. Look back. The agent reads last month versus the month before, so the plan starts from
   what actually happened, not from zero.
2. Freshen. The agent re-syncs the channels it plans from.
3. Landscape. The agent reads the tracked channels and their baselines.
4. Working set. The agent pulls a broad reading bundle and a tight shortlist, each carrying
   competitor outliers and the human's own performance side by side (unbiased).
5. Fill taste. For a strong outlier that has no analysis, the agent writes one and saves it
   with provenance, so its taste becomes durable crowsnest data.
6. Compose the month. The agent labels each candidate broad, medium, or narrow, applies the
   human's ratio, and writes the monthly overview document. The human approves.
7. Weekly refresh (repeats every week). The agent pulls a rising, short window outlier
   surface to catch a surge, names the event from its own world knowledge, runs the weekly
   funnel model, and writes a reactive weekly plan. The human approves.
8. Produce and publish. On the day, the agent runs the existing remix chain to a draft
   `planned_post`; the human records, publishes, and watches the data, which feeds step 1 of
   the next cycle.

## New and changed MCP tools

All tools follow the existing `mcp-server.ts` contract: `result()` on success,
`errorResult()` on a handled failure, thin wrappers over query or service functions.

### Read (item 2)

- `crowsnest_channels`: the tracked channels and their fleets. Backed by `getChannelsList`
  or `getKanbanBoard`.
- `crowsnest_channel_stats`: one channel's baseline, median basis, consistency, and last sync
  health. Backed by `getChannelDetail`, `getChannelMedianBasis`, `getLastRunHealth`.
- `crowsnest_research_set`: a broad reading bundle for a theme or niche: outliers with their
  analyses and channel context, plus the human's own comparable performance (`reachIndex`) so
  each candidate is read against both baselines. Backed by `getOutlierFeed` joined with
  `videoAnalyses` and the own channel query.
- `crowsnest_outlier_pack`: a tight top N shortlist ready to act on, with the media handoff and
  the same own benchmark block. Supports a rising mode (short `sinceDays`, ranked by recency
  and velocity) so a launch surge surfaces for the weekly refresh.

### Sync control (item 3)

- `crowsnest_sync_selected(channelIds)`: starts a sync scoped to the given channels and returns
  a job id. Requires a non empty channel id array; there is no library wide default. Backed by
  `startSyncAction`.
- `crowsnest_sync_status(jobId)`: the run's progress. Backed by `getSyncProgressAction`.
- `crowsnest_sync_cancel(jobId)`: cooperative cancel. Backed by `cancelSyncAction`.

### Changed read

- `crowsnest_metrics`: gains a prior period comparison so the agent can read this window against
  the one before it (month over month), instead of only a trailing window from now. Backed by an
  extension to `getOwnChannelOverview`.

### Write (item 4a)

- `crowsnest_save_analysis(videoId, fields)`: the agent authors the analysis (it is the model);
  the tool validates the fields against `VideoAnalysisSchema` and upserts the `video_analyses`
  row with `source = "mcp"`. No in app LLM call. Remix (`describeSourceStructure`) and Ideas
  read the same table unchanged, so they consume the agent artifact with no change.

## Data changes

- One migration: add a `source` column to `video_analyses` (nullable text, values such as
  `mcp`, `auto`, `manual`). Backfill existing rows as `legacy`. This is the only schema change.
- No new tables. No sidecar, env, or launchd change.

## Two honest boundaries

- Own performance and competitor performance are different units. The human's posts score on
  `reachIndex` (reach over the human's own median reach); competitors score on `outlierScore`
  (views over the competitor's own baseline). The agent cross references by format, hook, and
  topic; there is no single shared number, and the tools return both rather than pretending
  otherwise.
- Crowsnest can surface a surge (a cluster of new high view videos about a topic). Naming the
  event (a specific product launch) is the agent's world knowledge, not crowsnest's. Crowsnest's
  job is to surface the surge fast enough that the weekly plan can react.

## Security

The MCP endpoint has no auth; any local process that can reach the bound interface can call the
tools, the same trust boundary the existing remix write tools already sit behind. The new sync
control tools trigger real Instagram traffic and `save_analysis` writes rows, so both get a
security-lite case, but neither changes the trust boundary. Single user, localhost.

## Out of scope, to backlog

- Competitor CTA, conversion rate, target audience, and sales signal. Instagram does not expose
  these to scraping; log to `05-backlog` rather than fabricate.
- A first class `content_plan` artifact stored in crowsnest (plan B), and MCP scheduling to date
  a `planned_post`. The monthly calendar lives in the agent's markdown for now.
- Retiring the in app Analyze UI, `analyze-actions.ts`, and `auto-analyze.ts` (item 4b), gated on
  the agent analysis flow proving out first.
- Item 5, multi-account sharded sync.

## Testing approach

- Route and action (vitest against the tool handlers over a temp SQLite database): each new tool's
  contract, the non empty channel id guard on `sync_selected`, the `save_analysis` schema
  validation and `source` stamping, the prior period math on `metrics`, and the own benchmark join
  on the research tools.
- A live MCP round trip through an in memory client for at least the read tools and `save_analysis`
  (addresses the existing ENH-2 backlog note that the current test harness drives private
  internals).
- browse-e2e is thin here: the MCP has no UI. The dashboard surfaces the same data through the same
  queries, so any UI assertion rides the existing feed and channels journeys, not a new one.
- Follow the component test gate: every shipped case marked with its status marker before
  the phase closes.

## Open questions

- Whether the own channel is synced through the sidecar (so its posts carry `outlierScore` too) or
  is Graph only (so `reachIndex` is the only own performance signal). Confirm in Phase 2; it changes
  only how rich the own benchmark block is, not the shape of the tools.
- The exact prior period contract on `metrics` (two explicit windows, or a single window plus an
  offset). Settle in Phase 2 against `getOwnChannelOverview`.
