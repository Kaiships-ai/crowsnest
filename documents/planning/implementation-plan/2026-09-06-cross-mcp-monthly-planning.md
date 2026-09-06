---
status: active
components: [mcp, analyze, mine]
backlog: mcp#none
owner: session_013imHyms3RLPZ5tVJFFHCBo
shipped: null
---

# MCP monthly and weekly planning tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: per the plan owner's preference, execute this as a **quick build**: ONE build sub-agent carries all tasks end to end in order, then ONE reviewer does a whole-branch review. Do not fan out one agent per task. The mandatory test gate (unit + route/action + the live MCP round trip) still runs before the work is called done. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add eight MCP tools plus one migration so an MCP client (Claude or Codex) can drive a realistic monthly and weekly content plan from crowsnest: read the landscape, benchmark ideas against both competitor outliers and the user's own reach, save agent-authored analyses, and control syncs.

**Architecture:** Every new tool is a thin wrapper over an existing query or action, following the `mcp-server.ts` `registerTool` + `result()`/`errorResult()` contract already used by the 19 shipped tools. The only schema change is one nullable `source` column on analyze's `video_analyses` table. Remix and Ideas read that table unchanged. No new tables, no sidecar/env/launchd change.

**Tech Stack:** TypeScript, Next.js (self-hosted node server), better-sqlite3 + drizzle-orm, drizzle-kit migrations, `@modelcontextprotocol/sdk`, zod, vitest.

**Spec:** `documents/planning/spec/2026-09-06-mcp-monthly-planning.md`

## Global Constraints

- All tools return through the existing contract: `result(value)` on success, `errorResult(payload)` on a handled failure, never a thrown exception across the MCP boundary (`src/server/mcp/mcp-server.ts:37-56`).
- `crowsnest_sync_selected` accepts only an explicit non-empty `channelIds` array; there is no library-wide default (matches `runSync`'s own validation at `src/server/services/sync-engine.ts:1644`).
- `crowsnest_save_analysis` never calls the in-app LLM; the agent supplies the analysis, the tool validates against `VideoAnalysisSchema` and stamps `source = "mcp"`.
- Own performance (`reachIndex`) and competitor performance (`outlierScore`) are different units; tools return both, never a merged single number.
- Writing/tests: `npm run build`, `npm run test`, `npm run lint`, `npm run typecheck` all pass and the tree stays clean before finishing (AGENTS.md).
- Docs already written in Phase 2 (`documents/architect/core-components/mcp/02,03,04`); the doc-sync pass (Phase 5) flips their status markers to built after this ships.

---

### Task 1: Add the `source` provenance column to `video_analyses`

**Files:**
- Modify: `src/server/db/schema.ts` (the `videoAnalyses` table, after the `model` column)
- Create: `drizzle/0027_<name>.sql` (generated, then hand-edit to backfill)
- Test: `src/server/services/analyze.test.ts` (add a case) or a new `src/server/db/video-analyses-source.test.ts`

**Interfaces:**
- Produces: `videoAnalyses.source` — `text("source")`, nullable, values `"mcp" | "auto" | "manual" | "legacy"`. Existing rows backfilled `"legacy"`. Consumed by Task 2.

- [ ] **Step 1: Add the column to the schema**

In `src/server/db/schema.ts`, inside `videoAnalyses`, directly after `model: text("model"),`:

```ts
  /**
   * Origin of the text analysis: "mcp" (an agent authored it through
   * crowsnest_save_analysis), "auto" (the retired auto-analyze pass), "manual"
   * (the in-app Analyze action), or "legacy" (written before this column existed).
   * Distinct from `model`, which names the text model; two rows can share a model
   * yet differ in who asked for the analysis.
   */
  source: text("source"),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0027_*.sql` adding `source` to `video_analyses`.

- [ ] **Step 3: Backfill existing rows to "legacy"**

Append to the generated `drizzle/0027_*.sql`:

```sql
--> statement-breakpoint
UPDATE `video_analyses` SET `source` = 'legacy' WHERE `source` IS NULL;
```

- [ ] **Step 4: Write the failing test**

```ts
// src/server/db/video-analyses-source.test.ts
import { afterEach, expect, test } from "vitest";
import { makeTestDb } from "@/server/db/testing"; // use this repo's temp-db helper; if the
// name differs, follow the pattern in mcp-server.test.ts / analyze.test.ts for a migrated temp db.

test("video_analyses has a source column that accepts mcp", async () => {
  const { db, tables } = await makeTestDb();
  await db.insert(tables.videos).values({ id: "v1", channelId: "c1", platform: "instagram", externalId: "x1", postedAt: "2026-09-01T00:00:00.000Z" });
  await db.insert(tables.videoAnalyses).values({ videoId: "v1", createdAt: "2026-09-01T00:00:00.000Z", source: "mcp" });
  const [row] = await db.select().from(tables.videoAnalyses).where(/* eq videoId v1 */);
  expect(row.source).toBe("mcp");
});
```

Adapt the temp-db bootstrap to this repo's existing pattern (see `src/server/mcp/mcp-server.test.ts` for how it migrates a temp SQLite db). If a shared helper does not exist, inline the same migrate-on-a-temp-file setup that file uses.

- [ ] **Step 5: Run to verify fail, then pass**

Run: `npx vitest run src/server/db/video-analyses-source.test.ts`
Expected: FAIL before the schema/migration change is applied to the temp db, PASS after.

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema.ts drizzle/ src/server/db/video-analyses-source.test.ts
git commit -m "feat(analyze): add source provenance column to video_analyses"
```

---

### Task 2: `crowsnest_save_analysis` tool (agent-authored analysis)

**Files:**
- Modify: `src/server/mcp/mcp-server.ts` (register a new tool; add an import for the schema + db)
- Modify: `src/server/services/analyze.ts` (add a `saveAgentAnalysis` service function)
- Test: `src/server/services/analyze.test.ts` and `src/server/mcp/mcp-server.test.ts`

**Interfaces:**
- Consumes: `videoAnalyses.source` (Task 1), `VideoAnalysisSchema` (`src/server/llm/schemas`).
- Produces: `saveAgentAnalysis(videoId, fields): Promise<{ ok: true } | { ok: false; error: string }>` and the MCP tool `crowsnest_save_analysis`.

- [ ] **Step 1: Write the failing service test**

```ts
// in src/server/services/analyze.test.ts
test("saveAgentAnalysis validates and upserts with source=mcp", async () => {
  const { db, tables } = await makeTestDb();
  await db.insert(tables.videos).values({ id: "v1", channelId: "c1", platform: "instagram", externalId: "x1", postedAt: "2026-09-01T00:00:00.000Z" });
  const ok = await saveAgentAnalysis("v1", {
    hookType: "question", structureSegments: [], formatTags: ["talking-head"],
    styleTags: ["fast-cut"], whyItWorked: "clear promise", summary: "why it works",
  }, { db });
  expect(ok).toEqual({ ok: true });
  const [row] = await db.select().from(tables.videoAnalyses); // eq videoId v1
  expect(row.source).toBe("mcp");
  expect(row.hookType).toBe("question");
});
```

- [ ] **Step 2: Implement `saveAgentAnalysis`**

In `src/server/services/analyze.ts`:

```ts
import { VideoAnalysisSchema } from "@/server/llm/schemas";

/**
 * Save an analysis the AGENT authored (through crowsnest_save_analysis), not one the
 * in-app model produced. Validates the fields against the same VideoAnalysisSchema the
 * in-app path validates, then upserts the video_analyses row stamped source="mcp". Never
 * calls the LLM. Returns a result object rather than throwing, for the MCP boundary.
 */
export async function saveAgentAnalysis(
  videoId: string,
  fields: unknown,
  opts?: { db?: typeof db },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const database = opts?.db ?? db;
  const [video] = await database.select().from(tables.videos).where(eq(tables.videos.id, videoId)).limit(1);
  if (!video) return { ok: false, error: "video not found" };
  const parsed = VideoAnalysisSchema.safeParse(fields);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  const a = parsed.data;
  const textFields = {
    hookType: a.hookType, structureSegments: a.structureSegments, formatTags: a.formatTags,
    styleTags: a.styleTags, whyItWorked: a.whyItWorked, source: "mcp" as const,
  };
  const [existing] = await database.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId)).limit(1);
  if (existing) {
    await database.update(tables.videoAnalyses).set(textFields).where(eq(tables.videoAnalyses.videoId, videoId));
  } else {
    await database.insert(tables.videoAnalyses).values({ videoId, ...textFields, createdAt: nowIso() });
  }
  return { ok: true };
}
```

Confirm `VideoAnalysisSchema`'s exact field set before wiring (open the schema file); include `summary` only if the schema has it. Do not invent fields the schema does not define.

- [ ] **Step 3: Register the MCP tool**

In `src/server/mcp/mcp-server.ts`, add near the other write-capable tools:

```ts
import { saveAgentAnalysis } from "@/server/services/analyze";

server.registerTool(
  "crowsnest_save_analysis",
  {
    title: "Save an agent-authored analysis",
    description: "Save the analysis YOU (the agent) wrote for a video, with provenance. Validates the fields and stores them stamped source=\"mcp\". Remix and Ideas then read this analysis. Does not call any in-app model.",
    inputSchema: {
      videoId: z.string().describe("The video id, from crowsnest_feed."),
      hookType: z.string().describe("The hook type."),
      structureSegments: z.array(z.any()).describe("Structure segments, per the analysis schema."),
      formatTags: z.array(z.string()).describe("Format tags."),
      styleTags: z.array(z.string()).describe("Style tags."),
      whyItWorked: z.string().describe("Why the video worked."),
      summary: z.string().optional().describe("Optional one-line summary."),
    },
  },
  async (args) => {
    const r = await saveAgentAnalysis(args.videoId, args);
    return r.ok ? result({ ok: true, videoId: args.videoId }) : errorResult({ error: r.error, videoId: args.videoId });
  }
);
```

Match the `inputSchema` shape to `VideoAnalysisSchema` exactly once you have read it.

- [ ] **Step 4: MCP handler test**

```ts
// in src/server/mcp/mcp-server.test.ts, using the file's existing callTool helper
test("crowsnest_save_analysis stores an agent analysis with source=mcp", async () => {
  // seed a video, callTool(server, "crowsnest_save_analysis", { videoId, ...validFields })
  // assert result ok and the row's source === "mcp"
});
test("crowsnest_save_analysis rejects invalid fields without writing a row", async () => {
  // callTool with a missing required field, assert isError and no row written
});
```

- [ ] **Step 5: Run tests, then commit**

Run: `npx vitest run src/server/services/analyze.test.ts src/server/mcp/mcp-server.test.ts`
Expected: PASS.

```bash
git add src/server/services/analyze.ts src/server/mcp/mcp-server.ts src/server/services/analyze.test.ts src/server/mcp/mcp-server.test.ts
git commit -m "feat(mcp): crowsnest_save_analysis, agent-authored analysis with provenance"
```

---

### Task 3: `crowsnest_metrics` prior-period comparison

**Files:**
- Modify: `src/server/queries/own-channel.ts` (`getOwnChannelOverview` gains an `offsetDays`)
- Modify: `src/server/mcp/mcp-server.ts` (the existing `crowsnest_metrics` handler)
- Test: `src/server/queries/own-channel.test.ts`, `src/server/mcp/mcp-server.test.ts`

**Interfaces:**
- Produces: `getOwnChannelOverview(windowDays?, opts?: { offsetDays?: number })` where `offsetDays` shifts the window back by that many days. `crowsnest_metrics` returns `{ current, previous, posts }`.

- [ ] **Step 1: Write the failing query test**

```ts
test("getOwnChannelOverview offsetDays selects the prior window", async () => {
  // seed own posts: some in the last 30 days, some 30-60 days ago
  const current = await getOwnChannelOverview(30, { offsetDays: 0 });
  const previous = await getOwnChannelOverview(30, { offsetDays: 30 });
  expect(current.postsInWindow).toBe(/* count in last 30d */);
  expect(previous.postsInWindow).toBe(/* count in 30-60d ago */);
});
```

- [ ] **Step 2: Add `offsetDays` to the window math**

In `getOwnChannelOverview`, replace the single-cutoff filter with a start/end window:

```ts
export async function getOwnChannelOverview(
  windowDays: number = DEFAULT_WINDOW_DAYS,
  opts: { offsetDays?: number } = {},
): Promise<OwnChannelOverview> {
  // ...existing snapshot + allPosts load...
  const offsetDays = opts.offsetDays ?? 0;
  const now = Date.now();
  const end = new Date(now - offsetDays * 86_400_000).toISOString();
  const start = new Date(now - (offsetDays + windowDays) * 86_400_000).toISOString();
  const inWindow = allPosts.filter((p) => p.postedAt >= start && p.postedAt < end);
  // ...rest unchanged, using inWindow...
}
```

Keep the default behavior identical when `offsetDays` is 0 (start = now - windowDays, end = now; `< end` includes everything up to now).

- [ ] **Step 3: Update `crowsnest_metrics` to return both windows**

In `src/server/mcp/mcp-server.ts`, change the `crowsnest_metrics` handler body:

```ts
async (args) => {
  try {
    const windowDays = args.windowDays ?? DEFAULT_WINDOW_DAYS;
    const current = await getOwnChannelOverview(windowDays, { offsetDays: 0 });
    const previous = await getOwnChannelOverview(windowDays, { offsetDays: windowDays });
    const posts = await getOwnPosts({ limit: args.limit ?? 20 });
    return result({ current, previous, posts });
  } catch (err) {
    return errorResult({ error: err instanceof Error ? err.message : "metrics unavailable", hint: "set an own channel and a valid Graph token" });
  }
}
```

Import `DEFAULT_WINDOW_DAYS` (or read the same default `getOwnChannelOverview` uses) so the two windows match. Update the tool `description` to mention the prior-period comparison.

- [ ] **Step 4: Handler test + run + commit**

```ts
test("crowsnest_metrics returns current and previous windows", async () => {
  // seed own posts across two 30-day windows, callTool crowsnest_metrics
  // assert result has current, previous, posts
});
```

Run: `npx vitest run src/server/queries/own-channel.test.ts src/server/mcp/mcp-server.test.ts`

```bash
git add src/server/queries/own-channel.ts src/server/mcp/mcp-server.ts src/server/queries/own-channel.test.ts src/server/mcp/mcp-server.test.ts
git commit -m "feat(mcp): crowsnest_metrics prior-period comparison"
```

---

### Task 4: Sync control tools (`sync_selected` / `sync_status` / `sync_cancel`)

**Files:**
- Modify: `src/server/mcp/mcp-server.ts` (three new tools; import the sync actions)
- Test: `src/server/mcp/mcp-server.test.ts`

**Interfaces:**
- Consumes: `startSyncAction(channelIds?)`, `getSyncProgressAction(jobId)`, `cancelSyncAction(jobId)` (`src/server/actions/sync-actions.ts`), each already returning a result object.

- [ ] **Step 1: Write the failing handler tests**

```ts
test("crowsnest_sync_selected rejects an empty channelIds array", async () => {
  const r = await callTool(server, "crowsnest_sync_selected", { channelIds: [] });
  expect(r.isError).toBe(true); // no library-wide default
});
test("crowsnest_sync_selected starts a scoped sync and returns a jobId", async () => {
  // with a stubbed/seeded sync path, assert result carries a jobId
});
```

- [ ] **Step 2: Register the three tools**

In `src/server/mcp/mcp-server.ts`:

```ts
import { startSyncAction, getSyncProgressAction, cancelSyncAction } from "@/server/actions/sync-actions";

server.registerTool(
  "crowsnest_sync_selected",
  {
    title: "Sync selected channels",
    description: "Start a sync for exactly the given channel ids and return a job id. Requires a non-empty channelIds array; there is no whole-library default.",
    inputSchema: { channelIds: z.array(z.string()).describe("The channel ids to sync, from crowsnest_channels. Must be non-empty.") },
  },
  async (args) => {
    if (!Array.isArray(args.channelIds) || args.channelIds.length === 0) {
      return errorResult({ error: "channelIds must be a non-empty array", code: "NO_CHANNELS" });
    }
    const r = await startSyncAction(args.channelIds);
    return r.ok ? result({ jobId: r.jobId }) : errorResult({ error: r.error, code: r.code });
  }
);

server.registerTool(
  "crowsnest_sync_status",
  {
    title: "Sync status",
    description: "Read a sync run's progress by job id.",
    inputSchema: { jobId: z.string().describe("The job id from crowsnest_sync_selected.") },
  },
  async (args) => {
    const r = await getSyncProgressAction(args.jobId);
    return r.ok ? result(r.progress) : errorResult({ error: r.error });
  }
);

server.registerTool(
  "crowsnest_sync_cancel",
  {
    title: "Cancel a sync",
    description: "Request cooperative cancel of a running sync by job id. The run stops at the next channel boundary keeping committed work.",
    inputSchema: { jobId: z.string().describe("The job id from crowsnest_sync_selected.") },
  },
  async (args) => {
    const r = await cancelSyncAction(args.jobId);
    return r.ok ? result({ ok: true, jobId: args.jobId }) : errorResult({ error: r.error });
  }
);
```

Confirm the exact success-field names on each action's result (`jobId`, `progress`) against `sync-actions.ts` before finishing; adapt if they differ.

- [ ] **Step 3: Run tests, then commit**

Run: `npx vitest run src/server/mcp/mcp-server.test.ts`

```bash
git add src/server/mcp/mcp-server.ts src/server/mcp/mcp-server.test.ts
git commit -m "feat(mcp): sync control tools (sync_selected/status/cancel)"
```

---

### Task 5: Research read tools (`channels` / `channel_stats` / `research_set` / `outlier_pack`)

**Files:**
- Create: `src/server/queries/research.ts` (the two bundle queries)
- Modify: `src/server/mcp/mcp-server.ts` (four new tools)
- Test: `src/server/queries/research.test.ts`, `src/server/mcp/mcp-server.test.ts`

**Interfaces:**
- Consumes: `getChannelsList`/`getKanbanBoard`, `getChannelDetail`, `getChannelMedianBasis` (`queries/channels.ts`); `getLastRunHealth` (`queries/runs.ts`); `getOutlierFeed` (`queries/feed.ts`); `getOwnPosts` (`queries/own-channel.ts`); `mediaInfoFor` (`mcp-server.ts`).
- Produces:
  - `getResearchSet(opts): Promise<{ outliers: ResearchOutlier[]; ownBenchmark: OwnBenchmarkRow[] }>`
  - `getOutlierPack(opts: { limit?: number; sinceDays?: number; rising?: boolean }): Promise<{ items: OutlierPackItem[]; ownBenchmark: OwnBenchmarkRow[] }>`
  - where `ResearchOutlier` = a feed item plus its `videoAnalyses` fields, and `OwnBenchmarkRow` = `{ format: string; reachIndex: number | null; postedAt: string }` from the user's own posts, so each competitor outlier can be read against the user's comparable reach.

- [ ] **Step 1: Write the failing query tests**

```ts
// src/server/queries/research.test.ts
test("getResearchSet returns competitor outliers with analyses plus own reachIndex benchmark", async () => {
  // seed a competitor channel with scored outlier videos + analyses, and own posts with reachIndex
  const set = await getResearchSet({ minScore: 3, limit: 10 });
  expect(set.outliers.length).toBeGreaterThan(0);
  expect(set.outliers[0]).toHaveProperty("hookType"); // analysis joined
  expect(set.ownBenchmark[0]).toHaveProperty("reachIndex"); // own side, distinct unit
});
test("getOutlierPack rising mode ranks recent high-velocity items first", async () => {
  const pack = await getOutlierPack({ limit: 5, sinceDays: 7, rising: true });
  expect(pack.items.length).toBeLessThanOrEqual(5);
});
```

- [ ] **Step 2: Implement `getResearchSet` and `getOutlierPack`**

In `src/server/queries/research.ts`, build on `getOutlierFeed` (do not re-implement the feed SQL). Join each returned item to its `video_analyses` row, and load the own-channel benchmark from `getOwnPosts`:

```ts
import { getOutlierFeed, type FeedFilters } from "@/server/queries/feed";
import { getOwnPosts } from "@/server/queries/own-channel";
import { db, tables } from "@/server/db";
import { inArray } from "drizzle-orm";

export interface OwnBenchmarkRow { format: string; reachIndex: number | null; postedAt: string; }

async function ownBenchmark(): Promise<OwnBenchmarkRow[]> {
  const { items } = await getOwnPosts({ limit: 50 });
  return items.map((p) => ({ format: p.format, reachIndex: p.reachIndex, postedAt: p.postedAt }));
}

async function attachAnalyses<T extends { videoId: string }>(items: T[]) {
  if (items.length === 0) return items.map((i) => ({ ...i, analysis: null }));
  const rows = await db.select().from(tables.videoAnalyses)
    .where(inArray(tables.videoAnalyses.videoId, items.map((i) => i.videoId)));
  const byId = new Map(rows.map((r) => [r.videoId, r]));
  return items.map((i) => ({ ...i, analysis: byId.get(i.videoId) ?? null }));
}

export async function getResearchSet(filters: FeedFilters = {}) {
  const { items } = await getOutlierFeed({ sort: "score", limit: 24, ...filters });
  const outliers = await attachAnalyses(items);
  return { outliers, ownBenchmark: await ownBenchmark() };
}

export async function getOutlierPack(opts: { limit?: number; sinceDays?: number; rising?: boolean } = {}) {
  // rising = recent window, ranked by a velocity proxy (outlierScore over recency).
  // Reuse the feed's own sort where possible: "recent" for rising within sinceDays,
  // "score" otherwise. Keep the ranking honest and simple; do not invent a new metric
  // the feed query cannot back.
  const { items } = await getOutlierFeed({
    sort: opts.rising ? "recent" : "score",
    sinceDays: opts.sinceDays,
    limit: opts.limit ?? 8,
  });
  const withAnalyses = await attachAnalyses(items);
  return { items: withAnalyses, ownBenchmark: await ownBenchmark() };
}
```

Verify `FeedItem` carries `videoId` (open `feed.ts`); if the field is named differently, map it. Confirm `getOwnPosts`' `OwnPostRow` fields (`format`, `reachIndex`, `postedAt`) — they exist per `own-channel.ts`.

- [ ] **Step 3: Register the four tools**

In `src/server/mcp/mcp-server.ts` (feed handoff on outlier_pack via `mediaInfoFor`):

```ts
import { getChannelsList, getChannelDetail, getChannelMedianBasis } from "@/server/queries/channels";
import { getLastRunHealth } from "@/server/queries/runs";
import { getResearchSet, getOutlierPack } from "@/server/queries/research";

server.registerTool("crowsnest_channels", {
  title: "Tracked channels",
  description: "The channels crowsnest tracks, with their fleets. The set the agent plans from.",
  inputSchema: {},
}, async () => result({ channels: await getChannelsList() }));

server.registerTool("crowsnest_channel_stats", {
  title: "Channel stats",
  description: "One channel's baseline, median basis, and last sync health.",
  inputSchema: { channelId: z.string().describe("The channel id, from crowsnest_channels.") },
}, async (args) => {
  const detail = await getChannelDetail(args.channelId);
  if (!detail) return errorResult({ error: "not found", channelId: args.channelId });
  const basis = await getChannelMedianBasis(args.channelId);
  const health = getLastRunHealth();
  return result({ detail, basis, lastRun: health });
});

server.registerTool("crowsnest_research_set", {
  title: "Research set",
  description: "A broad reading bundle: top outliers with their analyses and channel context, plus your own reachIndex benchmark, so each idea reads against both competitor outlierScore and your own reach (different units, both returned).",
  inputSchema: {
    minScore: z.number().optional(), sinceDays: z.number().optional(),
    query: z.string().optional(), limit: z.number().optional(),
  },
}, async (args) => result(await getResearchSet({ minScore: args.minScore, sinceDays: args.sinceDays, query: args.query, limit: args.limit ?? 24 })));

server.registerTool("crowsnest_outlier_pack", {
  title: "Outlier pack",
  description: "A tight top-N shortlist ready to act on: outliers with analyses, the media handoff, and your own benchmark. Set rising=true with a short sinceDays to surface this week's surges (e.g. a launch) for the weekly refresh.",
  inputSchema: {
    limit: z.number().optional().describe("Max items, default 8."),
    sinceDays: z.number().optional().describe("Only videos within this many days."),
    rising: z.boolean().optional().describe("Rank by recency/velocity for a weekly surge."),
  },
}, async (args) => {
  const pack = await getOutlierPack({ limit: args.limit ?? 8, sinceDays: args.sinceDays, rising: args.rising });
  const items = await Promise.all(pack.items.map(async (i) => ({
    ...i,
    media: await mediaInfoFor(i.videoAssetId ?? null),
    thumbnail: await mediaInfoFor(i.thumbnailAssetId ?? null),
  })));
  return result({ items, ownBenchmark: pack.ownBenchmark });
});
```

Confirm the feed item's media-asset field names (`videoAssetId`, `thumbnailAssetId`) against `FeedItem` before wiring the handoff; if the pack items do not carry asset ids, fetch them the way `crowsnest_video` does.

- [ ] **Step 4: Handler tests + run + commit**

```ts
test("crowsnest_channels returns the tracked channels", async () => { /* seed channels, callTool, assert */ });
test("crowsnest_research_set returns outliers + own benchmark", async () => { /* callTool, assert both keys */ });
test("crowsnest_outlier_pack returns at most limit items with media handoff", async () => { /* callTool limit 3 */ });
```

Run: `npx vitest run src/server/queries/research.test.ts src/server/mcp/mcp-server.test.ts`

```bash
git add src/server/queries/research.ts src/server/mcp/mcp-server.ts src/server/queries/research.test.ts src/server/mcp/mcp-server.test.ts
git commit -m "feat(mcp): research read tools (channels, channel_stats, research_set, outlier_pack)"
```

---

### Task 6: Live MCP round-trip test harness

**Files:**
- Modify or create: `src/server/mcp/mcp-roundtrip.test.ts`

**Interfaces:**
- Consumes: `buildMcpServer()` (`mcp-server.ts`), the SDK's in-memory transport + `Client`.

This addresses the existing `mcp#ENH-2` backlog note (the current tests drive the private `_registeredTools` registry). A client round trip would have caught the structuredContent-must-be-a-record defect.

- [ ] **Step 1: Write the round-trip test**

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "./mcp-server";
import { expect, test } from "vitest";

test("a client can list and call the new read tools over a real transport", async () => {
  const server = buildMcpServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const tools = await client.listTools();
  expect(tools.tools.map((t) => t.name)).toEqual(expect.arrayContaining([
    "crowsnest_channels", "crowsnest_research_set", "crowsnest_outlier_pack",
    "crowsnest_sync_selected", "crowsnest_save_analysis",
  ]));
  const res = await client.callTool({ name: "crowsnest_channels", arguments: {} });
  expect(res.isError).not.toBe(true);
});
```

Confirm the SDK import paths against the installed `@modelcontextprotocol/sdk` version; adjust `InMemoryTransport`'s path if the package exposes it elsewhere.

- [ ] **Step 2: Run, then commit; close ENH-2**

Run: `npx vitest run src/server/mcp/mcp-roundtrip.test.ts`

Edit `documents/architect/core-components/mcp/05-backlog-to-enhance.md`: change ENH-2's Status to `closed` (or remove the row) and note this plan.

```bash
git add src/server/mcp/mcp-roundtrip.test.ts documents/architect/core-components/mcp/05-backlog-to-enhance.md
git commit -m "test(mcp): live client round-trip harness, closes ENH-2"
```

---

## Final gate (before calling the work done)

- [ ] `npm run build && npm run test && npm run lint && npm run typecheck` all pass, tree clean.
- [ ] `node .gitnexus/run.cjs detect-changes --scope all --repo .` (or the MCP tool) run before the final commit.
- [ ] One reviewer sub-agent does a whole-branch review (per the quick-execute preference).
- [ ] Phase 5 doc-sync (separate step): flip the mcp `03`/`02` status markers from planned to built, run the test gate to mark `04` cases 🟢/🔴/🟡, and add any deviations to `05-backlog`.

## Two open questions to resolve during build (from the spec)

1. **Own-channel outlier source.** Confirm whether the own channel is synced through the sidecar (its posts would then also carry `outlierScore` in `videos`) or is Graph-only (so `reachIndex` from `own_posts` is the only own signal). This only changes how rich `ownBenchmark` is, not the tool shapes. If the own channel is synced, `getResearchSet` may also surface its `outlierScore`; if not, `reachIndex` stands alone.
2. **Prior-period contract.** This plan uses `getOwnChannelOverview(windowDays, { offsetDays })`. Confirm that matches how the own-post window is actually computed (post-count window vs day range); the median is computed over a post-count window today, so keep the median semantics unchanged and apply `offsetDays` only to the day-range `inWindow` filter.

## Out of scope (deferred, do not build here)

- Competitor CTA, conversion, audience, sales signal (Instagram does not expose these).
- A `content_plan` table (plan B) and MCP scheduling to date a `planned_post`.
- Retiring the in-app Analyze UI, `analyze-actions.ts`, and `auto-analyze.ts` (item 4b), gated on this flow proving out.
- Item 5 (multi-account sharded sync).
