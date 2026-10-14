---
status: active
components: [mine, shared]
backlog: mine#B-16
owner: phase-3 planner session (feat/dashboard-my-reels)
shipped: null
---

# mine Dashboard rework implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended), or execute the plan directly in this session, phase by phase, verifying each phase before moving to the next. Steps use checkbox (`- [ ]`) syntax for tracking. Kai's preference: ONE builder runs every task in order, then ONE reviewer. No fan-out.

**Goal:** Move mine onto the Dashboard as the My reels and Calendar tabs, add per-reel insights, a views-over-time curve, account-wide audience, and an hourly/daily scheduled Graph measurement (features 9 to 14).

**Architecture:** One measurement service (`own-measure.ts`) owns every write to the own-channel tables; "Measure now" and a new in-process scheduler both call it under one single-flight lock and a 150-call budget. Pure functions (`reel-insights.ts`) shape rates and the typical-reel median curve on the server; the Dashboard page reads `?tab=` and renders exactly one tab server component, so each tab runs only its own reads. `/mine` becomes a redirect.

**Tech Stack:** Next 16 app router (read `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md` and `03-file-conventions/page.md` before Phase D), drizzle + better-sqlite3, vitest (node and jsdom), recharts via `src/components/ui/chart.tsx`, shadcn primitives in `src/components/ui/`, the `browse` CLI journeys in `scripts/e2e/`.

**Spec:** `documents/architect/core-components/mine/01-concept-brief.md`, `02-architecture.md` (sections 1.2, 2.1, 4, 6, 7, 8, 9), `03-feature-description.md` (features 9 to 14, sections 15 and 16), `04-test-cases.md` (MINE-16..36, ACTION-15..32, E2E-13..26, SEC-03..07).

## Global Constraints

- One additive drizzle migration, generated with `npm run db:generate`; no data rewritten, no column renamed or dropped.
- Graph API budget: at most 150 calls per measurement run; Instagram's limit is 200 calls per hour per user.
- New reels (posted within 72 hours) are due hourly; older posts are due when their latest capture is 24 hours old or more. A post with no capture is due.
- A metric the API did not return is stored as null and shown as a dash, never as 0 or 0%.
- Per-viewer rate = metric / `reach`; null when reach is null or 0, or the metric is null.
- Typical reel = median views at the same whole hour since posting across OTHER reels; null (a gap) where no other reel was measured at that hour.
- `?tab=` values: `overview | reels | calendar`; anything else is Overview. `/mine` redirects to `/?tab=calendar`, carrying only a valid `month` (`YYYY-MM`).
- `readAndBumpDashboardLastVisit` runs on the Overview tab only.
- Chart data is shaped on the server; the client chart receives only the selected reel's point list.
- The Graph token never reaches HTML, an RSC payload, an action result, or a log line.
- The Graph token is currently rejected: every automated test mocks `fetch` or `graphClient`. Live rows (E2E-04, E2E-06, E2E-12, E2E-20, MINE-36) stay 🟡 with "needs a valid Graph token".
- UI: use `src/components/ui/*` primitives and `documents/architect/shared/design-system.md` (semantic tokens only, `text-2xs` mono labels, `data-num` on numbers, `Card`/`Item`/`Tabs`/`Badge`, `<Button render={<Link />}>` for link buttons). No design skill.
- Docs: no em or en dashes, straight quotes, sentence-case headings, evergreen wording.
- Repo gates before every commit that touches code: the task's vitest file passes; before the final commit `npm run build && npm run test && npm run lint && npm run typecheck` all pass.
- GitNexus: run `node .gitnexus/run.cjs impact "<symbol>" --file <path> --direction upstream --repo .` before editing each existing symbol a task names (results are pre-recorded in the sweep table below; re-run if the index is stale), and `node .gitnexus/run.cjs detect-changes --scope all --repo .` before each commit.

---

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `src/server/db/schema.ts` | modify | `ownPosts.thumbnailUrl`; five new `ownPostInsights` columns; new `ownAccountBreakdowns` table |
| `drizzle/0030_*.sql`, `drizzle/meta/0030_snapshot.json`, `drizzle/meta/_journal.json` | create/modify | The generated additive migration |
| `src/server/graph/client.ts` | modify | `fetchMedia`, `fetchPostInsights` (extended set + one fallback + `profile_activity`), `fetchAccountBreakdowns`, `mapBioLinkTaps`; `fetchPosts` removed in B1 |
| `src/server/graph/client.test.ts` | modify | Client tests (ACTION-22, 23, 25, SEC-05) |
| `src/server/services/own-measure.ts` | create | `measureOwnChannel`, `isDue`, lock, budget, breakdown write |
| `src/server/services/own-measure.test.ts` | create | ACTION-12, 13, 26, 28..32, breakdown write |
| `src/server/services/own-measure.security.test.ts` | create | SEC-04, SEC-06 with the real client and a stubbed `fetch` |
| `src/server/services/own-measure-scheduler.ts` | create | `runDueOwnMeasure`, `startOwnMeasureScheduler` |
| `src/server/services/own-measure-scheduler.test.ts` | create | ACTION-27 |
| `src/server/actions/graph-actions.ts` | modify | `measureOwnChannelAction` becomes a wrapper + `revalidatePath("/")` |
| `src/server/actions/graph-actions.test.ts` | modify | Wrapper test (ACTION-18 part); checkToken tests kept |
| `server.ts` | modify | Boot `startOwnMeasureScheduler()` in its own try/catch |
| `.env.example` | modify | Optional `OWN_MEASURE_SCHEDULER_INTERVAL_MS` |
| `src/server/services/reel-insights.ts` | create | Pure: `perViewerRate`, `shapeReelInsights`, `selectReel`, `hoursSincePosted`, `typicalViewsCurve`, shared reel types |
| `src/server/services/reel-insights.test.ts` | create | ACTION-19 (fallback), 20, 21, 24 |
| `src/server/queries/own-channel.ts` | modify | `getOwnReels`, `getReelViewHistory`, `getAccountBreakdowns`, `OWN_AUDIENCE_FETCH_ERROR_KEY`, `WIRED` flip |
| `src/server/queries/own-channel.test.ts` | modify | ACTION-15 (updated), ACTION-19, breakdown read |
| `src/components/mine/month-param.ts` (+ `.test.ts`) | create | `validMonth`, `mineRedirectTarget` (ACTION-16, SEC-07) |
| `src/components/mine/calendar-tab.tsx` | create | `CalendarTab`, `ownChannelPicker` |
| `src/components/mine/mine-calendar.tsx` (+ test) | modify | Month links carry `tab=calendar`; `mine-delete-undo` |
| `src/components/mine/my-reels-tab.tsx` | create | My reels server component |
| `src/components/dashboard/dashboard-tabs.tsx` (+ `.test.ts`) | create | `DashboardTabs`, `resolveDashboardTab` (ACTION-17) |
| `src/components/dashboard/overview-tab.tsx` | create | Today's Dashboard body, moved |
| `src/app/(shell)/(loaded)/page.tsx` | modify | Reads `searchParams`, renders strip + one tab |
| `src/app/(shell)/(loaded)/mine/page.tsx` | modify | Redirect only |
| `src/components/layout/nav-items.ts`, `src/components/layout/topbar.tsx` | modify | Drop "My channel" entry and its orphaned title |
| `src/server/actions/planned-post-actions.ts` (+ test) | modify | Six `revalidatePath("/mine")` become `"/"` |
| `src/components/mine/own-stat-tiles.tsx`, `reach-by-post-bars.tsx`, `own-weekday-rhythm.tsx`, `graph-connect-panel.tsx`, `plan-dialog.tsx` | modify | B-16 testids |
| `src/components/mine/reel-picker.tsx`, `reel-insight-panel.tsx`, `reel-views-over-time.tsx`, `account-audience.tsx` | create | My reels UI |
| `src/components/mine/reels-ui.test.tsx` | create | jsdom render tests for the four reels components |
| `scripts/seed-e2e.ts` | modify | Junk Graph token in the `secrets` table |
| `scripts/e2e/mine-seed.ts` | create | Resets own-channel rows to a named variant for one journey |
| `scripts/e2e/mine-e2e-02.sh` | modify | Arrive on `/?tab=calendar` |
| `scripts/e2e/mine-e2e-{14,15,16,17,18,19,21,22,23,24,25,26}.sh` | create | Offline journeys |
| `documents/architect/core-components/mine/01..05`, `shared/navigation-and-shell.md`, `shared/persistence.md`, `publish/02-architecture.md` | modify | Docs true to the build |

---

## Cross-module reuse sweep

Every file or component named in a Limitations or Business rules bullet of 01, 02, or 03 for features 2 to 14, checked for a task:

| Named in docs | Task | Note |
| --- | --- | --- |
| `own-channel-picker.tsx`, `setOwnChannelAction` | D1 (`ownChannelPicker` gate reused by both tabs) | Not edited; B-15 stays open |
| `unsetOwnChannelAction` (B-15) | none | Out of scope, no control added |
| `own-stat-tiles.tsx`, `reach-by-post-bars.tsx`, `own-weekday-rhythm.tsx` | D2 (moved into My reels), E1 (testids) | |
| `getOwnPosts({ limit: 100 })` | D2 | Reused unchanged |
| `plan-dialog.tsx`, `savePlanEditAction` | E1 (testids only) | |
| `mine-calendar.tsx`, `markPlanPublishedAction`, `deletePlannedPostAction` | D1 (month links), E1 (`mine-delete-undo`) | |
| `/mine/<publishedOwnPostId>` dead link (B-17) | none | Stays open; listed in Risks |
| `graph-connect-panel.tsx`, `graph-actions.ts` | B4, E1 | Panel copy (".env.local and restart") unchanged, known limitation |
| `publish-dialog.tsx`, publish flags | D1 (flags move into `CalendarTab`) | Dialog not edited |
| `src/server/graph/client.ts` | A2, A3, A4, B1 | |
| `sync-scheduler.ts`, `publish-scheduler.ts` pattern | B5 | Copied shape, not edited |
| `server.ts` | B5 | |
| `nav-items.ts` | D4 | |
| `src/app/(shell)/(loaded)/page.tsx`, `mine/page.tsx` | D3, D4 | |
| `revalidatePath("/mine")` in planner and graph actions | D5, B4 | |
| `getScripts` (vault), `getCalendarMonth`, `getChannelsList`, `getOwnChannel` | D1, D2 | Called, not edited |
| `scoreMinUsablePosts` | D2 | Read, not edited |
| `crowsnest_metrics` MCP tool | C3 | Reads `getOwnChannelOverview`; `wired` flag flips, see Risks |
| Remix finish and vault script dialog links to `/mine` | D4 | Not edited; redirect carries them |
| `scripts/seed-e2e.ts`, `scripts/e2e/mine-e2e-02.sh` | F1, F2 | |
| `own_audience_fetch_error` app setting | B3, C3 | Same pattern as `own_comments_fetch_error` |

### GitNexus impact results (upstream)

Run with `node .gitnexus/run.cjs impact "<symbol>" [--file <path>] --direction upstream --repo .`. UNKNOWN verdicts were confirmed by text search.

| Symbol | Risk | Direct callers (d=1) | Plan mapping |
| --- | --- | --- | --- |
| `getPostsWithLatestInsights` | **HIGH** (5 direct, 13 total, 3 processes) | `getOwnChannelOverview`, `getOwnPosts`, `getCalendarMonth`, `getPlannedPostById`, `getPlannedPosts` | **Not edited.** New reads are separate functions (C3). Skip. |
| `getOwnChannelOverview` | LOW (2 direct) | `MinePage`, `buildMcpServer` | C3 edits only the `WIRED` constant; `MinePage` caller moves to `MyReelsTab` (D2); MCP output change in Risks |
| `measureOwnChannelAction` | LOW (1) | `GraphConnectPanel.measure` | B4; result is a superset of today's fields, panel unchanged |
| `checkGraphTokenAction` | **HIGH** (5 direct, 7 total) | `graphAuthLive` (publish-evidence), `MinePage`, `SettingsPage`, two `recheck`s | **Not edited**, only called from `MyReelsTab` (D2). Skip. |
| `graphClient` | UNKNOWN, text search: `graph-actions.ts`, `graph-actions.test.ts`, `client.test.ts`; publish uses the separate exported `createReelContainer`/`pollReelContainer`/`publishReel` | | A2..A4 add methods; B1 removes `fetchPosts` (only caller `graph-actions.ts`, moved into the service) |
| `mapInsights`, `emptyInsights`, `buildPost` | LOW (1 each) | `fetchPosts` | A2, A3; `buildPost` replaced by `buildMedia` in A2 |
| `DashboardPage` | UNKNOWN (route entry; text search finds no importer) | | D3 |
| `MinePage` | UNKNOWN (route entry; inbound `/mine` links: `stage-finish.tsx`, `script-detail-dialog.tsx`, `mine-e2e-02.sh`) | | D4 redirect keeps links working; F2 moves the e2e script |
| `MineCalendar` | LOW (1) | `MinePage` | D1; caller becomes `CalendarTab` |
| `NAV_ITEMS` | UNKNOWN, text search: `command-menu.tsx`, `NAV_GROUPS` -> `sidebar.tsx`, `sidebar.test.tsx` | | D4; run `sidebar.test.tsx` |
| `startSyncScheduler` | LOW (1) | `server.ts` | Not edited; B5 adds a sibling call in `server.ts` |
| `GraphConnectPanel`, `OwnStatTiles`, `ReachByPostBars`, `OwnPostList`, `OwnWeekdayRhythm` | LOW (1 each) | `MinePage` | D2 moves the caller; E1 adds testids |
| `uploadPlanVideoAction` | **HIGH** (1 direct, 3 total) | `PublishDialog.upload` | D5 changes one string literal; behavior of callers unchanged |
| `setPlanCaptionAction` | **HIGH** (1 direct, 4 total) | `PublishDialog.saveCaption` | D5, same |
| `schedulePublishAction`, `publishNowAction` | LOW (1) | `PublishDialog.submit` | D5 |
| `cancelScheduledPublishAction`, `retryFailedPublishAction` | LOW (1 direct, 3 total) | `MineCalendar.cancelScheduled`, `.retry` | D5 |

HIGH warnings for the reviewer: the two HIGH symbols the plan could have touched (`getPostsWithLatestInsights`, `checkGraphTokenAction`) are deliberately left unedited. The two HIGH publish actions get a one-literal change (`"/mine"` to `"/"`), covered by D5's test.

## Surface sweep

| Surface | Answer |
| --- | --- |
| `.env.local` keys | No new required key. One optional `OWN_MEASURE_SCHEDULER_INTERVAL_MS` (default 3600000) documented in `.env.example` (B5). `IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID`, `IG_GRAPH_API_VERSION` unchanged; whether new metrics need a version bump is open (02 section 9). |
| drizzle schema/migration | Yes. One additive migration `drizzle/0030_*.sql` via `npm run db:generate` (A1): `own_posts.thumbnail_url`, five `own_post_insights` columns, table `own_account_breakdowns` + index. Dev db: `npm run db:backup && npm run db:migrate`. Kit buyers: `kai _postupdate` already runs `migrate.ts`; the `drizzle/` folder already ships in `packaging/build-bundle.sh`. |
| launchd services | No plist change. `com.crowsnest.server.plist` runs `server.ts`, so the scheduler boots with the app; `com.crowsnest.ig.plist` (sidecar) untouched. |
| Sidecar contract | Untouched. Measurement calls only `graph.instagram.com` (SEC-06 test in B6). |
| `server.ts` boot | Yes. `startOwnMeasureScheduler()` beside the publish and sync schedulers, own try/catch (B5). First tick fires one interval after boot; due-ness is derived from stored captures, so a restart loses nothing. |
| MCP | `crowsnest_metrics` output: `profileVisits` and `followsFromPost` report `wired: true` after C3. No tool schema change. |

## Test-coverage plan

| 04 row(s) | Task | Lens |
| --- | --- | --- |
| ACTION-12, ACTION-13 | B1 | vitest, mocked client |
| ACTION-15 (updated: now wired) | C3 | vitest |
| ACTION-16, SEC-07 | D4 | vitest (pure) + E2E-15 |
| ACTION-17 | D3 | vitest (pure) |
| ACTION-18 | B4 (measure), D5 (planner) | vitest, `next/cache` mocked |
| ACTION-19 | C1 (fallback), C3 (read) | vitest |
| ACTION-20, ACTION-21 | C1 | vitest (pure) |
| ACTION-22, ACTION-23 | A3 | vitest, `fetch` stubbed |
| ACTION-24 | C2 | vitest (pure) |
| ACTION-25 | A4 | vitest, `fetch` stubbed |
| ACTION-26, 29, 30, 31, 32 | B2 | vitest, mocked client |
| ACTION-28 | B1 | vitest |
| ACTION-27 | B5 | vitest |
| SEC-04, SEC-06 | B6 | vitest, real client, `fetch` stubbed |
| SEC-05 | B6 | vitest, real client |
| SEC-03 | F5 | curl the three tab responses for the junk token string |
| MINE-16, 17, 20, 21 | D3, D4 + E2E-14, 21, 26 | browse |
| MINE-18, MINE-19 | D1, D4 + E2E-15 | browse |
| MINE-22..35 | E2..E6 + E2E-16..19, 21..25 | browse, seeded rows + junk token |
| MINE-36, E2E-20, E2E-04, E2E-06, E2E-12 | none | 🟡 needs a valid Graph token |
| E2E-13 | none | Feature 8, not in this rework; stays "not run" (it needs no Graph token row while `.env.local` may hold one) |
| E2E-14..19, 21..26 | F2..F4 | `scripts/e2e/mine-e2e-NN.sh` |
| E2E-01, 03, 05, 07, 10, 11 (seed-blocked shipped rows) | none | `mine-seed.ts` variants make them unblockable later; out of scope here |

---

## Phase A: migration, schema, Graph client fetchers

### Task A1: Schema and the additive migration

**Files:**
- Modify: `src/server/db/schema.ts` (the `ownPosts` and `ownPostInsights` tables near lines 666 to 702; add `ownAccountBreakdowns` after `ownComments`)
- Create: `drizzle/0030_*.sql`, `drizzle/meta/0030_snapshot.json`; Modify: `drizzle/meta/_journal.json` (all generated)
- Test: `src/server/queries/own-channel.test.ts`

**Interfaces:**
- Produces: `tables.ownPosts.thumbnailUrl` (text, nullable); `tables.ownPostInsights.{reposts, skipRate, bioLinkTaps, avgWatchTimeMs, totalWatchTimeMs}`; `tables.ownAccountBreakdowns` with `{ id, capturedAt, metric, dimension, key, value, timeframe }`.

- [ ] **Step 1: Write the failing test** (append to `src/server/queries/own-channel.test.ts`, reusing its existing `db`, `tables`, `migrate` setup)

```ts
describe("reel columns and own_account_breakdowns (migration 0030)", () => {
  test("new nullable columns and the breakdowns table accept a write", async () => {
    await db.insert(tables.ownPosts).values({
      id: "p-mig", externalId: "x-mig", permalink: "https://i/x", mediaType: "VIDEO", productType: "REELS",
      format: "Reel", postedAt: "2026-09-01T00:00:00.000Z", firstSeenAt: "2026-09-01T00:00:00.000Z",
      thumbnailUrl: "https://cdn/x.jpg",
    });
    await db.insert(tables.ownPostInsights).values({
      id: "i-mig", ownPostId: "p-mig", capturedAt: "2026-09-01T01:00:00.000Z",
      reposts: 3, skipRate: 41.5, bioLinkTaps: 7, avgWatchTimeMs: 4500, totalWatchTimeMs: 900000,
    });
    await db.insert(tables.ownAccountBreakdowns).values({
      id: "b-mig", capturedAt: "2026-09-01T01:00:00.000Z", metric: "views", dimension: "follower_type", key: "FOLLOWER", value: 10, timeframe: "day",
    });
    const [row] = await db.select().from(tables.ownPostInsights).where(eq(tables.ownPostInsights.id, "i-mig"));
    expect(row).toMatchObject({ reposts: 3, skipRate: 41.5, bioLinkTaps: 7, avgWatchTimeMs: 4500, totalWatchTimeMs: 900000 });
  });
});
```

(Import `eq` from `drizzle-orm` at the top of the file if it is not already imported; clean the three tables in the file's `beforeEach` if it does not already delete `ownPostInsights`/`ownPosts`, and add `await db.delete(tables.ownAccountBreakdowns)` there.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/server/queries/own-channel.test.ts`
Expected: FAIL, type error / "Property 'ownAccountBreakdowns' does not exist" or "table own_posts has no column named thumbnail_url".

- [ ] **Step 3: Edit the schema**

In `ownPosts`, after `lastMeasuredAt`:

```ts
  /** Instagram CDN link from the media list; refreshed on every measurement, may expire. */
  thumbnailUrl: text("thumbnail_url"),
```

In `ownPostInsights`, after `watchTimeSec`:

```ts
  /** Reel metrics added with the Dashboard rework. Null until a measurement returns them. */
  reposts: integer("reposts"),
  /** reels_skip_rate, straight from the API (marked in development by Meta). */
  skipRate: real("skip_rate"),
  /** profile_activity with breakdown=action_type, the bio link action. */
  bioLinkTaps: integer("bio_link_taps"),
  /** ig_reels_avg_watch_time, milliseconds as returned. */
  avgWatchTimeMs: real("avg_watch_time_ms"),
  /** ig_reels_video_view_total_time, milliseconds; stored though no block shows it (a past hour cannot be re-fetched). */
  totalWatchTimeMs: real("total_watch_time_ms"),
```

After `ownComments`:

```ts
/** Account-wide breakdowns (follower split, engaged audience). One row per key per
 *  measurement batch; read as "newest batch per metric". A refusal for lack of volume is
 *  not a row: it lives in app_settings under own_audience_fetch_error. */
export const ownAccountBreakdowns = sqliteTable("own_account_breakdowns", {
  id: text("id").primaryKey(),
  capturedAt: text("captured_at").notNull(),
  metric: text("metric").notNull(), // "views" | "engaged_audience_demographics"
  dimension: text("dimension").notNull(), // "follower_type" | "age" | "country" | "gender"
  key: text("key").notNull(),
  value: integer("value").notNull(),
  timeframe: text("timeframe"),
}, (t) => [index("own_account_breakdowns_metric_captured").on(t.metric, t.capturedAt)]);
```

- [ ] **Step 4: Generate the migration and inspect it**

Run: `npm run db:generate`
Expected: one new file `drizzle/0030_<name>.sql`. Run `cat drizzle/0030_*.sql` and confirm it contains ONLY `ALTER TABLE ... ADD ...` (six), one `CREATE TABLE own_account_breakdowns`, one `CREATE INDEX own_account_breakdowns_metric_captured`. No `DROP`, no `__new_` table rebuild. If drizzle-kit prompts about a rename, answer "create column".

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/server/queries/own-channel.test.ts`
Expected: PASS.

- [ ] **Step 6: Migrate the dev db**

Run: `npm run db:backup && npm run db:migrate`
Expected: backup path printed, migrate exits 0.

- [ ] **Step 7: Commit**

```bash
node .gitnexus/run.cjs detect-changes --scope all --repo .
git add src/server/db/schema.ts drizzle/ src/server/queries/own-channel.test.ts
git commit -m "feat(mine): additive migration for reel metrics and account breakdowns"
```

### Task A2: Extended insight mapping, bio link parser, and `fetchMedia`

**Files:**
- Modify: `src/server/graph/client.ts`
- Test: `src/server/graph/client.test.ts`

**Interfaces:**
- Produces:
  - `GraphPostInsights` gains `reposts, skipRate, avgWatchTimeMs, totalWatchTimeMs, bioLinkTaps: number | null`; `profileVisits` now maps `profile_visits`, `followsFromPost` maps `follows`; `watchTimeSec` stays always null.
  - `export interface GraphMedia { externalId: string; permalink: string; mediaType: string; productType: string | null; format: string; caption: string | null; postedAt: string; likeCount: number | null; commentsCount: number | null; thumbnailUrl: string | null }`
  - `export const BIO_LINK_ACTION = "BIO_LINK_CLICKED"`; `export function mapBioLinkTaps(raw: unknown): number | null`
  - `graphClient.fetchMedia(limit = 50): Promise<GraphMedia[]>` (throws `GraphApiError` when the list call fails).

- [ ] **Step 1: Write the failing tests** (in `client.test.ts`: replace the test "unrequested metrics (profileVisits, followsFromPost, watchTimeSec) are always null" and the `toEqual` block in "mapInsights" to include the new fields; add the rest)

```ts
describe("mapInsights, extended reel set", () => {
  test("maps follows, profile_visits and the new reel metrics; watchTimeSec stays null", async () => {
    const { mapInsights } = await loadClient();
    const raw = { data: [
      { name: "views", values: [{ value: 120000 }] },
      { name: "reach", values: [{ value: 80997 }] },
      { name: "follows", values: [{ value: 12 }] },
      { name: "profile_visits", values: [{ value: 40 }] },
      { name: "reposts", values: [{ value: 9 }] },
      { name: "reels_skip_rate", values: [{ value: 41.5 }] },
      { name: "ig_reels_avg_watch_time", values: [{ value: 4500 }] },
      { name: "ig_reels_video_view_total_time", values: [{ value: 900000 }] },
    ] };
    expect(mapInsights(raw, true)).toMatchObject({
      views: 120000, reach: 80997, followsFromPost: 12, profileVisits: 40, reposts: 9,
      skipRate: 41.5, avgWatchTimeMs: 4500, totalWatchTimeMs: 900000, watchTimeSec: null, bioLinkTaps: null, error: null,
    });
  });
});

describe("mapBioLinkTaps", () => {
  const withActions = (results: unknown[]) => ({ data: [{ name: "profile_activity", total_value: { value: 0, breakdowns: [{ dimension_keys: ["action_type"], results }] } }] });
  test("takes the bio link action value", async () => {
    const { mapBioLinkTaps } = await loadClient();
    expect(mapBioLinkTaps(withActions([{ dimension_values: ["CALL"], value: 2 }, { dimension_values: ["BIO_LINK_CLICKED"], value: 7 }]))).toBe(7);
  });
  test("is null when the bio link action is absent", async () => {
    const { mapBioLinkTaps } = await loadClient();
    expect(mapBioLinkTaps(withActions([{ dimension_values: ["CALL"], value: 2 }]))).toBeNull();
  });
});

describe("graphClient.fetchMedia", () => {
  test("lists media with thumbnail_url and maps it", async () => {
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [
      { id: "r1", media_type: "VIDEO", media_product_type: "REELS", permalink: "https://i/r1", timestamp: "2026-09-01T00:00:00+0000", like_count: 5, comments_count: 2, caption: "c", thumbnail_url: "https://cdn/r1.jpg" },
    ] }) });
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    const media = await graphClient.fetchMedia();
    expect(media).toEqual([{ externalId: "r1", permalink: "https://i/r1", mediaType: "VIDEO", productType: "REELS", format: "Reel", caption: "c", postedAt: "2026-09-01T00:00:00+0000", likeCount: 5, commentsCount: 2, thumbnailUrl: "https://cdn/r1.jpg" }]);
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("fields")).toContain("thumbnail_url");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/server/graph/client.test.ts`
Expected: FAIL (`mapBioLinkTaps` not exported, `fetchMedia` not a function, new fields undefined).

- [ ] **Step 3: Implement** in `client.ts`

Add to `GraphPostInsights` (after `watchTimeSec`):

```ts
  reposts: number | null;
  /** reels_skip_rate, passed through untouched (Meta marks it in development). */
  skipRate: number | null;
  /** Milliseconds, as the API returns them. */
  avgWatchTimeMs: number | null;
  totalWatchTimeMs: number | null;
  bioLinkTaps: number | null;
```

Add `GraphMedia` (Interfaces above) and redefine `export interface GraphPost extends GraphMedia { insights: GraphPostInsights }` (kept until B1).

Helper beside `rec`/`str`/`num`: `function arr(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }`

`emptyInsights`: add `reposts: null, skipRate: null, avgWatchTimeMs: null, totalWatchTimeMs: null, bioLinkTaps: null`.

`mapInsights` return, replacing the three unrequested lines:

```ts
    profileVisits: stats.profile_visits ?? null,
    followsFromPost: stats.follows ?? null,
    watchTimeSec: null,
    reposts: stats.reposts ?? null,
    skipRate: stats.reels_skip_rate ?? null,
    avgWatchTimeMs: stats.ig_reels_avg_watch_time ?? null,
    totalWatchTimeMs: stats.ig_reels_video_view_total_time ?? null,
    bioLinkTaps: null,
    error: null,
```

Replace `buildPost` with `buildMedia` (same body minus `insights`, plus `thumbnailUrl: str(raw.thumbnail_url)`), and make `fetchPosts` push `{ ...buildMedia(m), insights }`.

```ts
/** Action type name for a bio link tap in profile_activity. ponytail: taken from Meta's
 *  docs, not a live response (02 section 9); a wrong name yields null, never a wrong number. */
export const BIO_LINK_ACTION = "BIO_LINK_CLICKED";

export function mapBioLinkTaps(raw: unknown): number | null {
  for (const row of arr(rec(raw).data)) {
    for (const b of arr(rec(rec(row).total_value).breakdowns)) {
      for (const r of arr(rec(b).results)) {
        if (arr(rec(r).dimension_values).includes(BIO_LINK_ACTION)) return num(rec(r).value);
      }
    }
  }
  return null;
}
```

Add to `GraphClient` and `graphClient`:

```ts
  async fetchMedia(limit = 50): Promise<GraphMedia[]> {
    const { token, userId } = requireConfigured();
    const result = await graphGet<{ data?: unknown[] }>(
      `${userId}/media`,
      { fields: "id,media_type,media_product_type,permalink,timestamp,like_count,comments_count,caption,thumbnail_url", limit },
      token
    );
    if (!result.ok) throw new GraphApiError(errorCodeFor(result.kind), result.message);
    return arr(result.data.data).map((raw) => buildMedia(rec(raw)));
  },
```

Update the existing "mapInsights" `toEqual` expectation with the five new null fields.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/server/graph/client.test.ts src/server/actions/graph-actions.test.ts`
Expected: PASS (graph-actions tests still use `fetchPosts`; its `post()` helper needs the five new insight fields and `thumbnailUrl: null` added so `npm run typecheck` passes).

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/server/graph/client.ts src/server/graph/client.test.ts src/server/actions/graph-actions.test.ts
git commit -m "feat(mine): map extended reel metrics and list media with thumbnails"
```

### Task A3: `fetchPostInsights` with one fallback and `profile_activity`

**Files:**
- Modify: `src/server/graph/client.ts`
- Test: `src/server/graph/client.test.ts`

**Interfaces:**
- Consumes: `GraphMedia`, `mapInsights`, `mapBioLinkTaps`, `emptyInsights` (A2).
- Produces: `graphClient.fetchPostInsights(media: GraphMedia): Promise<{ insights: GraphPostInsights; callsUsed: number }>`. Throws `GraphApiError` with `GRAPH_AUTH_FAILED` or `GRAPH_RATE_LIMITED` (the run must stop); any other failure becomes `insights.error`. Non-reel: 1 call, core set. Reel: extended set, on non-fatal failure one retry with the core set plus `views`, then `profile_activity` when a metric call succeeded. Max 3 calls.

- [ ] **Step 1: Write the failing tests**

```ts
describe("graphClient.fetchPostInsights", () => {
  const REEL = { externalId: "r1", permalink: "", mediaType: "VIDEO", productType: "REELS", format: "Reel", caption: null, postedAt: "2026-09-01T00:00:00+0000", likeCount: null, commentsCount: null, thumbnailUrl: null };
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const metrics = (pairs: Record<string, number>) => ({ data: Object.entries(pairs).map(([name, value]) => ({ name, values: [{ value }] })) });
  const activity = (value: number | null) => ({ data: [{ name: "profile_activity", total_value: { breakdowns: [{ results: value === null ? [] : [{ dimension_values: ["BIO_LINK_CLICKED"], value }] }] } }] });

  beforeEach(() => { process.env.IG_GRAPH_TOKEN = "tok_secret"; process.env.IG_GRAPH_USER_ID = "17841400000000000"; });

  test("ACTION-22: bio link taps from profile_activity by action_type, null when absent", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(metrics({ views: 10, reach: 8 }))).mockResolvedValueOnce(ok(activity(7)))
      .mockResolvedValueOnce(ok(metrics({ views: 10, reach: 8 }))).mockResolvedValueOnce(ok(activity(null)));
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    expect((await graphClient.fetchPostInsights(REEL)).insights.bioLinkTaps).toBe(7);
    expect((await graphClient.fetchPostInsights(REEL)).insights.bioLinkTaps).toBeNull();
    const url = new URL(fetchMock.mock.calls[1][0] as string);
    expect(url.searchParams.get("metric")).toBe("profile_activity");
    expect(url.searchParams.get("breakdown")).toBe("action_type");
  });

  test("ACTION-23: a refused extended metric falls back to the core set without zeroing it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 100, message: "reels_skip_rate not supported" } }) })
      .mockResolvedValueOnce(ok(metrics({ views: 120000, reach: 80997, shares: 1112, likes: 50 })))
      .mockResolvedValueOnce(ok(activity(3)));
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    const { insights, callsUsed } = await graphClient.fetchPostInsights(REEL);
    expect(insights).toMatchObject({ views: 120000, reach: 80997, shares: 1112, likes: 50, skipRate: null, reposts: null, bioLinkTaps: 3, error: null });
    expect(callsUsed).toBe(3);
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("metric")).toContain("reels_skip_rate");
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get("metric")).toBe("reach,saved,shares,total_interactions,comments,likes,views");
  });

  test("a rate limit throws so the run can stop", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: { code: 4 } }) }));
    const { graphClient } = await loadClient();
    await expect(graphClient.fetchPostInsights(REEL)).rejects.toMatchObject({ code: "GRAPH_RATE_LIMITED" });
  });

  test("a non-reel makes one core call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(metrics({ reach: 5 })));
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    const { insights, callsUsed } = await graphClient.fetchPostInsights({ ...REEL, productType: "FEED", format: "Carousel" });
    expect(callsUsed).toBe(1);
    expect(insights.reach).toBe(5);
    expect(insights.views).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/server/graph/client.test.ts -t fetchPostInsights`
Expected: FAIL, `fetchPostInsights is not a function`.

- [ ] **Step 3: Implement**

```ts
const CORE_METRICS = "reach,saved,shares,total_interactions,comments,likes";
const REEL_CORE_METRICS = `${CORE_METRICS},views`;
const REEL_EXTENDED_METRICS =
  "views,reach,likes,comments,shares,saved,total_interactions,reposts,follows,profile_visits,ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate";

/** Auth and rate-limit failures end a measurement run; everything else is per-post. */
function throwIfFatal(result: GraphGetResult<unknown>): void {
  if (!result.ok && (result.kind === "auth" || result.kind === "rate_limit")) {
    throw new GraphApiError(errorCodeFor(result.kind), result.message);
  }
}
```

```ts
  async fetchPostInsights(media: GraphMedia): Promise<{ insights: GraphPostInsights; callsUsed: number }> {
    const { token } = requireConfigured();
    const path = `${media.externalId}/insights`;
    if (media.productType !== "REELS") {
      const r = await graphGet<unknown>(path, { metric: CORE_METRICS }, token);
      throwIfFatal(r);
      return { insights: r.ok ? mapInsights(r.data, false) : emptyInsights(r.message), callsUsed: 1 };
    }
    let callsUsed = 1;
    let r = await graphGet<unknown>(path, { metric: REEL_EXTENDED_METRICS }, token);
    throwIfFatal(r);
    if (!r.ok) {
      // One unsupported metric name fails the whole call; retry once with the set that
      // worked before the rework, so the post keeps its core numbers.
      callsUsed += 1;
      r = await graphGet<unknown>(path, { metric: REEL_CORE_METRICS }, token);
      throwIfFatal(r);
    }
    if (!r.ok) return { insights: emptyInsights(r.message), callsUsed };
    const insights = mapInsights(r.data, true);
    callsUsed += 1;
    const activity = await graphGet<unknown>(path, { metric: "profile_activity", breakdown: "action_type", metric_type: "total_value" }, token);
    throwIfFatal(activity);
    insights.bioLinkTaps = activity.ok ? mapBioLinkTaps(activity.data) : null;
    return { insights, callsUsed };
  },
```

Add `fetchPostInsights` to the `GraphClient` interface.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/server/graph/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/graph/client.ts src/server/graph/client.test.ts
git commit -m "feat(mine): per-post reel insights with core-set fallback and bio link taps"
```

### Task A4: `fetchAccountBreakdowns`

**Files:** Modify `src/server/graph/client.ts`; Test `src/server/graph/client.test.ts`

**Interfaces:**
- Produces: `export interface GraphBreakdownRow { metric: string; dimension: string; key: string; value: number; timeframe: string | null }`, `export interface GraphAccountBreakdowns { rows: GraphBreakdownRow[]; audienceError: string | null; callsUsed: number }`, `graphClient.fetchAccountBreakdowns(): Promise<GraphAccountBreakdowns>` (up to 4 calls; auth/rate limit throw; a demographics refusal sets `audienceError` and stops the demographics loop).

- [ ] **Step 1: Write the failing test (ACTION-25)**

```ts
describe("graphClient.fetchAccountBreakdowns", () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const results = (pairs: [string, number][]) => ({ data: [{ total_value: { breakdowns: [{ results: pairs.map(([k, value]) => ({ dimension_values: [k], value })) }] } }] });
  beforeEach(() => { process.env.IG_GRAPH_TOKEN = "tok_secret"; process.env.IG_GRAPH_USER_ID = "17841400000000000"; });

  test("follower split from views by follower_type, audience from engaged_audience_demographics", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(results([["FOLLOWER", 300], ["NON_FOLLOWER", 700]])))
      .mockResolvedValueOnce(ok(results([["25-34", 40], ["18-24", 30]])))
      .mockResolvedValueOnce(ok(results([["US", 50]])))
      .mockResolvedValueOnce(ok(results([["F", 60], ["M", 40]])));
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    const out = await graphClient.fetchAccountBreakdowns();
    expect(out.audienceError).toBeNull();
    expect(out.callsUsed).toBe(4);
    expect(out.rows).toContainEqual({ metric: "views", dimension: "follower_type", key: "NON_FOLLOWER", value: 700, timeframe: "day" });
    expect(out.rows).toContainEqual({ metric: "engaged_audience_demographics", dimension: "country", key: "US", value: 50, timeframe: "this_month" });
    const first = new URL(fetchMock.mock.calls[0][0] as string);
    expect(first.searchParams.get("breakdown")).toBe("follower_type");
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get("metric")).toBe("engaged_audience_demographics");
  });

  test("a lack-of-volume refusal returns a threshold state, not an empty audience", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(ok(results([["FOLLOWER", 3]])))
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 10, message: "Not enough users" } }) }));
    const { graphClient } = await loadClient();
    const out = await graphClient.fetchAccountBreakdowns();
    expect(out.audienceError).toContain("Not enough users");
    expect(out.rows.every((r) => r.metric === "views")).toBe(true);
    expect(out.callsUsed).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**: `npx vitest run src/server/graph/client.test.ts -t fetchAccountBreakdowns` -> FAIL.

- [ ] **Step 3: Implement**

```ts
function mapBreakdown(raw: unknown, metric: string, dimension: string, timeframe: string): GraphBreakdownRow[] {
  const out: GraphBreakdownRow[] = [];
  for (const row of arr(rec(raw).data)) {
    for (const b of arr(rec(rec(row).total_value).breakdowns)) {
      for (const r of arr(rec(b).results)) {
        const key = str(arr(rec(r).dimension_values)[0]);
        const value = num(rec(r).value);
        if (key !== null && value !== null) out.push({ metric, dimension, key, value, timeframe });
      }
    }
  }
  return out;
}
```

```ts
  async fetchAccountBreakdowns(): Promise<GraphAccountBreakdowns> {
    const { token, userId } = requireConfigured();
    const rows: GraphBreakdownRow[] = [];
    // ponytail: the since/until window for the views split is open (02 section 9); period=day
    // without a range, recorded as timeframe "day".
    const split = await graphGet<unknown>(`${userId}/insights`, { metric: "views", period: "day", metric_type: "total_value", breakdown: "follower_type" }, token);
    throwIfFatal(split);
    if (split.ok) rows.push(...mapBreakdown(split.data, "views", "follower_type", "day"));
    let callsUsed = 1;
    let audienceError: string | null = null;
    for (const dimension of ["age", "country", "gender"]) {
      callsUsed += 1;
      const r = await graphGet<unknown>(
        `${userId}/insights`,
        { metric: "engaged_audience_demographics", period: "lifetime", timeframe: "this_month", metric_type: "total_value", breakdown: dimension },
        token
      );
      throwIfFatal(r);
      if (!r.ok) {
        // Below 100 engagements Instagram refuses all three; one refusal answers for the rest.
        audienceError = r.message;
        break;
      }
      rows.push(...mapBreakdown(r.data, "engaged_audience_demographics", dimension, "this_month"));
    }
    return { rows, audienceError, callsUsed };
  },
```

Add it to `GraphClient`.

- [ ] **Step 4: Verify**: `npx vitest run src/server/graph/client.test.ts` -> PASS.
- [ ] **Step 5: Commit**: `git add src/server/graph/ && git commit -m "feat(mine): account-wide follower split and engaged audience fetch"`

---

## Phase B: measurement service, graph-actions wrapper, scheduler

### Task B1: `measureOwnChannel` (scope `all`) with the single-flight lock

**Files:**
- Create: `src/server/services/own-measure.ts`, `src/server/services/own-measure.test.ts`
- Modify: `src/server/queries/own-channel.ts` (add the key constant only), `src/server/graph/client.ts` (remove `fetchPosts` and `GraphPost`), `src/server/graph/client.test.ts` (delete the `graphClient.fetchPosts` describe; A2/A3 tests cover its replacement)

**Interfaces:**
- Consumes: `graphClient.fetchAccount`, `fetchMedia`, `fetchPostInsights`, `fetchAccountBreakdowns`, `fetchComments`, `GraphMedia`, `GraphPostInsights` (A2..A4); `OWN_COMMENTS_FETCH_ERROR_KEY`.
- Produces:
  - `export const OWN_AUDIENCE_FETCH_ERROR_KEY = "own_audience_fetch_error"` in `own-channel.ts`.
  - `export type MeasureScope = "all" | "due"`
  - `export interface MeasureSummary { measuredAt: string; postsSeen: number; postsMeasured: number; postsFailed: number; commentsSeen: number; partial: boolean; callsUsed: number; stoppedEarly: "budget" | "rate_limited" | "auth_failed" | null }`
  - `export type MeasureResult = ({ ok: true } & MeasureSummary) | { ok: false; error: string; code: GraphErrorCode | "MEASURE_BUSY" }`
  - `export async function measureOwnChannel(opts: { scope: MeasureScope; now?: Date; budget?: number }): Promise<MeasureResult>`
  - `export function toFailure(err: unknown): { ok: false; error: string; code: GraphErrorCode }`, `export function messageOf(err: unknown): string`

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { GraphMedia, GraphPostInsights } from "@/server/graph/client";
import { GraphApiError } from "@/server/graph/errors";

const graphClient = vi.hoisted(() => ({
  fetchAccount: vi.fn(), fetchMedia: vi.fn(), fetchPostInsights: vi.fn(),
  fetchAccountBreakdowns: vi.fn(), fetchComments: vi.fn(), checkToken: vi.fn(),
}));
vi.mock("@/server/graph/client", () => ({ graphClient, CLASSIFIER_VERSION: "test-classifier-v1" }));

process.env.CROWSNEST_DB_PATH = ":memory:";
process.env.IG_SERVICE_TOKEN ??= "test-token";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let svc: typeof import("./own-measure");

beforeAll(async () => {
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  svc = await import("./own-measure");
});

export const ACCOUNT = { id: "acct1", username: "kallaway", followersCount: 1000, followsCount: 50, mediaCount: 10 };
export function media(id: string, o: Partial<GraphMedia> = {}): GraphMedia {
  return { externalId: id, permalink: `https://i/${id}`, mediaType: "VIDEO", productType: "REELS", format: "Reel", caption: id, postedAt: "2026-09-01T00:00:00.000Z", likeCount: null, commentsCount: 0, thumbnailUrl: `https://cdn/${id}.jpg`, ...o };
}
export function insights(o: Partial<GraphPostInsights> = {}): GraphPostInsights {
  return { reach: 100, saved: 1, shares: 2, totalInteractions: 3, comments: 1, likes: 5, views: 200, profileVisits: 4, followsFromPost: 1, watchTimeSec: null, reposts: 1, skipRate: 40, avgWatchTimeMs: 4500, totalWatchTimeMs: 90000, bioLinkTaps: 2, error: null, ...o };
}

beforeEach(async () => {
  migrate();
  for (const t of [tables.ownComments, tables.ownPostInsights, tables.ownPosts, tables.ownAccountSnapshots, tables.ownAccountBreakdowns, tables.appSettings]) await db.delete(t);
  vi.clearAllMocks();
  graphClient.fetchAccount.mockResolvedValue(ACCOUNT);
  graphClient.fetchMedia.mockResolvedValue([]);
  graphClient.fetchPostInsights.mockResolvedValue({ insights: insights(), callsUsed: 2 });
  graphClient.fetchAccountBreakdowns.mockResolvedValue({ rows: [], audienceError: null, callsUsed: 4 });
  graphClient.fetchComments.mockResolvedValue([]);
});

describe("measureOwnChannel, scope all", () => {
  test("writes a snapshot, upserts posts with thumbnails, one insight row each with the new columns", async () => {
    graphClient.fetchMedia.mockResolvedValue([media("r1"), media("c1", { productType: "FEED", format: "Carousel" })]);
    const r = await svc.measureOwnChannel({ scope: "all" });
    expect(r).toMatchObject({ ok: true, postsSeen: 2, postsMeasured: 2, postsFailed: 0, partial: false });
    expect(await db.select().from(tables.ownAccountSnapshots)).toHaveLength(1);
    const posts = await db.select().from(tables.ownPosts);
    expect(posts.find((p) => p.externalId === "r1")?.thumbnailUrl).toBe("https://cdn/r1.jpg");
    const rows = await db.select().from(tables.ownPostInsights);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ reposts: 1, skipRate: 40, bioLinkTaps: 2, avgWatchTimeMs: 4500, totalWatchTimeMs: 90000, profileVisits: 4, followsFromPost: 1 });
  });

  test("ACTION-13: the account call failing is a hard failure with no rows", async () => {
    graphClient.fetchAccount.mockRejectedValue(new GraphApiError("GRAPH_AUTH_FAILED", "bad token"));
    const r = await svc.measureOwnChannel({ scope: "all" });
    expect(r).toMatchObject({ ok: false, code: "GRAPH_AUTH_FAILED" });
    expect(await db.select().from(tables.ownAccountSnapshots)).toHaveLength(0);
    expect(await db.select().from(tables.ownPosts)).toHaveLength(0);
  });

  test("ACTION-12: comments failing after posts succeed is ok with partial and a stored error", async () => {
    graphClient.fetchMedia.mockResolvedValue([media("r1", { commentsCount: 2 })]);
    graphClient.fetchComments.mockRejectedValue(new GraphApiError("GRAPH_RATE_LIMITED", "slow down"));
    const r = await svc.measureOwnChannel({ scope: "all" });
    expect(r).toMatchObject({ ok: true, partial: true, postsMeasured: 1 });
    expect(await db.select().from(tables.ownPostInsights)).toHaveLength(1);
    const [err] = await db.select().from(tables.appSettings);
    expect(err.key).toBe("own_comments_fetch_error");
  });

  test("a per-post insights error is stored on the row and counted failed", async () => {
    graphClient.fetchMedia.mockResolvedValue([media("r1")]);
    graphClient.fetchPostInsights.mockResolvedValue({ insights: insights({ reach: null, error: "HTTP 500" }), callsUsed: 2 });
    const r = await svc.measureOwnChannel({ scope: "all" });
    expect(r).toMatchObject({ ok: true, postsFailed: 1, postsMeasured: 0 });
    const [row] = await db.select().from(tables.ownPostInsights);
    expect(row.fetchError).toBe("HTTP 500");
  });
});

describe("single-flight lock", () => {
  test("ACTION-28: a due run while another run is in flight returns busy without calling Graph", async () => {
    let release!: () => void;
    graphClient.fetchAccount.mockImplementationOnce(() => new Promise((res) => { release = () => res(ACCOUNT); }));
    const first = svc.measureOwnChannel({ scope: "due" });
    const second = await svc.measureOwnChannel({ scope: "due" });
    expect(second).toMatchObject({ ok: false, code: "MEASURE_BUSY" });
    expect(graphClient.fetchAccount).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toMatchObject({ ok: true });
    expect(await db.select().from(tables.ownAccountSnapshots)).toHaveLength(1);
  });

  test("a manual run waits for the in-flight run instead of doubling calls", async () => {
    let release!: () => void;
    graphClient.fetchAccount.mockImplementationOnce(() => new Promise((res) => { release = () => res(ACCOUNT); }));
    const scheduled = svc.measureOwnChannel({ scope: "due" });
    const manual = svc.measureOwnChannel({ scope: "all" });
    await Promise.resolve();
    expect(graphClient.fetchAccount).toHaveBeenCalledTimes(1);
    release();
    await scheduled;
    expect(await manual).toMatchObject({ ok: true });
    expect(graphClient.fetchAccount).toHaveBeenCalledTimes(2);
  });
});
```

(Do not `export` from a test file in the real code; the `export` keywords above are shown only to name the helpers B2 reuses. Write them as plain `function`/`const` in the file; B2 appends to the same file.)

- [ ] **Step 2: Run to verify failure**: `npx vitest run src/server/services/own-measure.test.ts` -> FAIL (module not found).

- [ ] **Step 3: Implement `own-measure.ts`** (moves `upsertOwnPost`, `upsertOwnComment`, `setCommentsFetchError`, `toFailure`, `messageOf` out of `graph-actions.ts`; `graph-actions.ts` still has its copies until B4)

```ts
import { desc, eq, inArray } from "drizzle-orm";
import { db, newId, nowIso, tables } from "@/server/db";
import { log } from "@/server/lib/logger";
import { CLASSIFIER_VERSION, graphClient, type GraphAccount, type GraphComment, type GraphMedia, type GraphPostInsights } from "@/server/graph/client";
import { GraphApiError, type GraphErrorCode } from "@/server/graph/errors";
import { OWN_AUDIENCE_FETCH_ERROR_KEY, OWN_COMMENTS_FETCH_ERROR_KEY } from "@/server/queries/own-channel";

/**
 * The one writer of the own-channel tables (own_account_snapshots, own_posts,
 * own_post_insights, own_comments, own_account_breakdowns). "Measure now" calls it with
 * scope "all"; the scheduler with scope "due". A module-level single-flight lock covers
 * both: a due run finding the lock held returns MEASURE_BUSY, a manual run waits.
 */

export const OWN_MEASURE_CALL_BUDGET = 150;

export type MeasureScope = "all" | "due";
export interface MeasureSummary {
  measuredAt: string;
  postsSeen: number;
  postsMeasured: number;
  postsFailed: number;
  commentsSeen: number;
  partial: boolean;
  callsUsed: number;
  stoppedEarly: "budget" | "rate_limited" | "auth_failed" | null;
}
export type MeasureResult = ({ ok: true } & MeasureSummary) | { ok: false; error: string; code: GraphErrorCode | "MEASURE_BUSY" };

export function messageOf(err: unknown): string {
  if (err instanceof GraphApiError) return err.userMessage;
  return err instanceof Error ? err.message : String(err);
}

export function toFailure(err: unknown): { ok: false; error: string; code: GraphErrorCode } {
  if (err instanceof GraphApiError) return { ok: false, error: err.userMessage, code: err.code };
  log.error("graph.action.unexpected", { error: messageOf(err) });
  return { ok: false, error: messageOf(err), code: "GRAPH_UNKNOWN" };
}

async function setAppSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await db.delete(tables.appSettings).where(eq(tables.appSettings.key, key));
    return;
  }
  await db.insert(tables.appSettings).values({ key, value }).onConflictDoUpdate({ target: tables.appSettings.key, set: { value } });
}

async function upsertOwnPost(m: GraphMedia, measuredAt: string): Promise<string> {
  const [existing] = await db.select({ id: tables.ownPosts.id }).from(tables.ownPosts).where(eq(tables.ownPosts.externalId, m.externalId)).limit(1);
  const common = {
    permalink: m.permalink, mediaType: m.mediaType, productType: m.productType, format: m.format,
    caption: m.caption, postedAt: m.postedAt, thumbnailUrl: m.thumbnailUrl, lastMeasuredAt: measuredAt,
  };
  if (existing) {
    await db.update(tables.ownPosts).set(common).where(eq(tables.ownPosts.id, existing.id));
    return existing.id;
  }
  const id = newId();
  await db.insert(tables.ownPosts).values({ id, externalId: m.externalId, ...common, firstSeenAt: measuredAt });
  return id;
}

function insightColumns(i: GraphPostInsights) {
  return {
    reach: i.reach, saved: i.saved, shares: i.shares, totalInteractions: i.totalInteractions, comments: i.comments,
    likes: i.likes, views: i.views, profileVisits: i.profileVisits, followsFromPost: i.followsFromPost,
    watchTimeSec: i.watchTimeSec, reposts: i.reposts, skipRate: i.skipRate, bioLinkTaps: i.bioLinkTaps,
    avgWatchTimeMs: i.avgWatchTimeMs, totalWatchTimeMs: i.totalWatchTimeMs, fetchError: i.error,
  };
}

// upsertOwnComment: copy verbatim from graph-actions.ts (same body, same log line).

async function measureComments(account: GraphAccount): Promise<{ commentsSeen: number; partial: boolean }> {
  try {
    const comments = await graphClient.fetchComments(account.username);
    const allOwnPosts = await db.select({ id: tables.ownPosts.id, permalink: tables.ownPosts.permalink }).from(tables.ownPosts);
    const postIdByPermalink = new Map(allOwnPosts.map((p) => [p.permalink, p.id]));
    for (const c of comments) await upsertOwnComment(c, postIdByPermalink);
    await setAppSetting(OWN_COMMENTS_FETCH_ERROR_KEY, null);
    return { commentsSeen: comments.length, partial: false };
  } catch (err) {
    await setAppSetting(OWN_COMMENTS_FETCH_ERROR_KEY, messageOf(err));
    log.warn("graph.measure.comments_failed", { message: messageOf(err) });
    return { commentsSeen: 0, partial: true };
  }
}

async function runMeasure(opts: { scope: MeasureScope; now?: Date; budget?: number }): Promise<MeasureResult> {
  const now = opts.now ?? new Date();
  let callsUsed = 0;

  let account: GraphAccount;
  try {
    callsUsed += 1;
    account = await graphClient.fetchAccount();
  } catch (err) {
    return toFailure(err);
  }

  const measuredAt = now.toISOString();
  await db.insert(tables.ownAccountSnapshots).values({
    id: newId(), capturedAt: measuredAt, externalId: account.id, username: account.username,
    followerCount: account.followersCount, followsCount: account.followsCount, mediaCount: account.mediaCount,
  });

  let media: GraphMedia[];
  try {
    callsUsed += 1;
    media = await graphClient.fetchMedia();
  } catch (err) {
    return toFailure(err);
  }

  let postsMeasured = 0;
  let postsFailed = 0;
  const stoppedEarly: MeasureSummary["stoppedEarly"] = null;
  for (const m of media) {
    const fetched = await graphClient.fetchPostInsights(m);
    callsUsed += fetched.callsUsed;
    const ownPostId = await upsertOwnPost(m, measuredAt);
    await db.insert(tables.ownPostInsights).values({ id: newId(), ownPostId, capturedAt: measuredAt, ...insightColumns(fetched.insights) });
    if (fetched.insights.error) postsFailed += 1;
    else postsMeasured += 1;
  }

  let commentsSeen = 0;
  let partial = false;
  if (opts.scope === "all") ({ commentsSeen, partial } = await measureComments(account));

  log.info("graph.measure.done", { scope: opts.scope, postsSeen: media.length, postsMeasured, postsFailed, commentsSeen, partial, callsUsed });
  return { ok: true, measuredAt, postsSeen: media.length, postsMeasured, postsFailed, commentsSeen, partial, callsUsed, stoppedEarly };
}

let inFlight: Promise<MeasureResult> | null = null;

export async function measureOwnChannel(opts: { scope: MeasureScope; now?: Date; budget?: number }): Promise<MeasureResult> {
  if (inFlight && opts.scope === "due") return { ok: false, error: "A measurement is already running.", code: "MEASURE_BUSY" };
  while (inFlight) await inFlight.catch(() => undefined);
  const run = runMeasure(opts);
  inFlight = run;
  try {
    return await run;
  } finally {
    if (inFlight === run) inFlight = null;
  }
}
```

Add to `own-channel.ts` beside `OWN_COMMENTS_FETCH_ERROR_KEY`:

```ts
/** app_settings key holding the last engaged-audience refusal (for example under 100
 *  engagements). Row absent means the last fetch succeeded or none has run. */
export const OWN_AUDIENCE_FETCH_ERROR_KEY = "own_audience_fetch_error";
```

In `client.ts`: keep `fetchPosts` for now (graph-actions still calls it; removed in B4).

- [ ] **Step 4: Verify**: `npx vitest run src/server/services/own-measure.test.ts` -> PASS; `npm run typecheck` -> clean.
- [ ] **Step 5: Commit**: `git add src/server/services/own-measure.ts src/server/services/own-measure.test.ts src/server/queries/own-channel.ts && git commit -m "feat(mine): measurement service with single-flight lock"`

### Task B2: Due scope, call budget, rate-limit stop, per-post isolation

**Files:** Modify `src/server/services/own-measure.ts`; Test `src/server/services/own-measure.test.ts`

**Interfaces:**
- Produces: `export function isDue(postedAt: string, lastCapturedAt: string | null, now: Date): boolean`; `measureOwnChannel` honors `scope: "due"`, `budget` (default `OWN_MEASURE_CALL_BUDGET`), sets `stoppedEarly`.

- [ ] **Step 1: Write the failing tests** (append)

```ts
const H = 3_600_000;
const NOW = new Date("2026-09-29T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

async function seedCapture(externalId: string, postedAt: string, capturedAt: string) {
  const id = `own-${externalId}`;
  await db.insert(tables.ownPosts).values({ id, externalId, permalink: `https://i/${externalId}`, mediaType: "VIDEO", productType: "REELS", format: "Reel", postedAt, firstSeenAt: postedAt });
  await db.insert(tables.ownPostInsights).values({ id: `ins-${externalId}-${capturedAt}`, ownPostId: id, capturedAt, views: 1 });
}
const measuredIds = () => graphClient.fetchPostInsights.mock.calls.map(([m]) => (m as GraphMedia).externalId);

describe("isDue", () => {
  test("hourly inside 72 hours, daily after, always when never captured", () => {
    expect(svc.isDue(ago(2 * H), ago(61 * 60_000), NOW)).toBe(true);
    expect(svc.isDue(ago(71 * H), ago(61 * 60_000), NOW)).toBe(true);
    expect(svc.isDue(ago(2 * H), ago(30 * 60_000), NOW)).toBe(false);
    expect(svc.isDue(ago(5 * 24 * H), ago(23 * H), NOW)).toBe(false);
    expect(svc.isDue(ago(5 * 24 * H), null, NOW)).toBe(true);
  });
});

describe("measureOwnChannel, scope due", () => {
  test("ACTION-26: new reels hourly, the 5 day old reel only after a day", async () => {
    await seedCapture("new2h", ago(2 * H), ago(61 * 60_000));
    await seedCapture("new71h", ago(71 * H), ago(61 * 60_000));
    await seedCapture("old5d", ago(5 * 24 * H), ago(23 * H));
    graphClient.fetchMedia.mockResolvedValue([media("new2h", { postedAt: ago(2 * H) }), media("new71h", { postedAt: ago(71 * H) }), media("old5d", { postedAt: ago(5 * 24 * H) })]);
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(measuredIds().sort()).toEqual(["new2h", "new71h"]);
    graphClient.fetchPostInsights.mockClear();
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + 25 * H) });
    expect(measuredIds()).toContain("old5d");
  });

  test("ACTION-29: 250 due reels stay within the 150-call budget; leftovers are still due next hour", async () => {
    const list = Array.from({ length: 250 }, (_, i) => media(`r${i}`, { postedAt: ago(10 * 24 * H) }));
    graphClient.fetchMedia.mockResolvedValue(list);
    const first = await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(first).toMatchObject({ ok: true, stoppedEarly: "budget" });
    if (!first.ok) throw new Error("unreachable");
    expect(first.callsUsed).toBeLessThanOrEqual(150);
    const measuredFirst = new Set(measuredIds());
    graphClient.fetchPostInsights.mockClear();
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + H) });
    const measuredSecond = measuredIds();
    expect(measuredSecond.length).toBeGreaterThan(0);
    expect(measuredSecond.some((id) => measuredFirst.has(id))).toBe(false);
  });

  test("ACTION-30: a rate limit stops the run at once; earlier rows stay", async () => {
    graphClient.fetchMedia.mockResolvedValue(["a", "b", "c", "d", "e", "f"].map((id) => media(id)));
    graphClient.fetchPostInsights
      .mockResolvedValueOnce({ insights: insights(), callsUsed: 2 }).mockResolvedValueOnce({ insights: insights(), callsUsed: 2 })
      .mockResolvedValueOnce({ insights: insights(), callsUsed: 2 }).mockResolvedValueOnce({ insights: insights(), callsUsed: 2 })
      .mockRejectedValueOnce(new GraphApiError("GRAPH_RATE_LIMITED", "slow down"));
    const r = await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(r).toMatchObject({ ok: true, stoppedEarly: "rate_limited", postsMeasured: 4 });
    expect(graphClient.fetchPostInsights).toHaveBeenCalledTimes(5);
    expect(await db.select().from(tables.ownPostInsights)).toHaveLength(4);
  });

  test("ACTION-31: one reel throwing does not stop the others", async () => {
    graphClient.fetchMedia.mockResolvedValue([media("a"), media("b"), media("c")]);
    graphClient.fetchPostInsights
      .mockResolvedValueOnce({ insights: insights(), callsUsed: 2 })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ insights: insights(), callsUsed: 2 });
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    const rows = await db.select({ ownPostId: tables.ownPostInsights.ownPostId }).from(tables.ownPostInsights);
    expect(rows).toHaveLength(2);
  });

  test("ACTION-32: each run appends a snapshot row, never overwrites", async () => {
    await seedCapture("a", ago(2 * H), ago(2 * H));
    graphClient.fetchMedia.mockResolvedValue([media("a", { postedAt: ago(2 * H) })]);
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + H) });
    const rows = await db.select().from(tables.ownPostInsights);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.capturedAt)).size).toBe(3);
  });
});
```

- [ ] **Step 2: Run**: `npx vitest run src/server/services/own-measure.test.ts` -> FAIL (`isDue` missing, all posts measured, rejection thrown).

- [ ] **Step 3: Implement**

```ts
const HOUR_MS = 3_600_000;
const NEW_REEL_WINDOW_MS = 72 * HOUR_MS;

/** Hourly while a post is under 72 hours old, daily after, and always when never captured.
 *  Derived from stored captures on every tick, so the scheduler keeps no state. */
export function isDue(postedAt: string, lastCapturedAt: string | null, now: Date): boolean {
  if (lastCapturedAt === null) return true;
  const age = now.getTime() - Date.parse(postedAt);
  const sinceCapture = now.getTime() - Date.parse(lastCapturedAt);
  return sinceCapture >= (age < NEW_REEL_WINDOW_MS ? HOUR_MS : 24 * HOUR_MS);
}

async function latestCaptureByExternalId(externalIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (externalIds.length === 0) return out;
  const rows = await db
    .select({ externalId: tables.ownPosts.externalId, capturedAt: tables.ownPostInsights.capturedAt })
    .from(tables.ownPostInsights)
    .innerJoin(tables.ownPosts, eq(tables.ownPosts.id, tables.ownPostInsights.ownPostId))
    .where(inArray(tables.ownPosts.externalId, externalIds))
    .orderBy(desc(tables.ownPostInsights.capturedAt));
  for (const r of rows) if (!out.has(r.externalId)) out.set(r.externalId, r.capturedAt);
  return out;
}
```

Replace the post loop in `runMeasure`:

```ts
  const budget = opts.budget ?? OWN_MEASURE_CALL_BUDGET;
  const lastCaptured = opts.scope === "due" ? await latestCaptureByExternalId(media.map((m) => m.externalId)) : new Map<string, string>();
  const inScope = opts.scope === "all" ? media : media.filter((m) => isDue(m.postedAt, lastCaptured.get(m.externalId) ?? null, now));

  let postsMeasured = 0;
  let postsFailed = 0;
  let stoppedEarly: MeasureSummary["stoppedEarly"] = null;
  for (const m of inScope) {
    // Reserve the worst case (extended + fallback + profile_activity for a reel).
    if (callsUsed + (m.productType === "REELS" ? 3 : 1) > budget) {
      stoppedEarly = "budget";
      break;
    }
    let fetched: { insights: GraphPostInsights; callsUsed: number };
    try {
      fetched = await graphClient.fetchPostInsights(m);
    } catch (err) {
      callsUsed += 1;
      if (err instanceof GraphApiError && (err.code === "GRAPH_RATE_LIMITED" || err.code === "GRAPH_AUTH_FAILED")) {
        stoppedEarly = err.code === "GRAPH_RATE_LIMITED" ? "rate_limited" : "auth_failed";
        break;
      }
      log.warn("own_measure.post_failed", { externalId: m.externalId, error: messageOf(err) });
      continue;
    }
    callsUsed += fetched.callsUsed;
    const ownPostId = await upsertOwnPost(m, measuredAt);
    await db.insert(tables.ownPostInsights).values({ id: newId(), ownPostId, capturedAt: measuredAt, ...insightColumns(fetched.insights) });
    if (fetched.insights.error) postsFailed += 1;
    else postsMeasured += 1;
  }
```

Replace the comments block so comments respect the budget (their calls are 1 media list + 1 per post with comments):

```ts
  if (opts.scope === "all") {
    const commentCalls = 1 + media.filter((m) => (m.commentsCount ?? 0) > 0).length;
    if (stoppedEarly !== null || callsUsed + commentCalls > budget) {
      partial = true;
      await setAppSetting(OWN_COMMENTS_FETCH_ERROR_KEY, "Comments skipped: this run's Graph call budget was spent.");
    } else {
      ({ commentsSeen, partial } = await measureComments(account));
      callsUsed += commentCalls;
    }
  }
```

(`postsSeen` stays `media.length`.)

- [ ] **Step 4: Verify**: `npx vitest run src/server/services/own-measure.test.ts` -> PASS (B1 tests included).
- [ ] **Step 5: Commit**: `git commit -am "feat(mine): due scope, 150-call budget, and rate-limit stop for measurement"`

### Task B3: Daily account breakdowns in the measurement

**Files:** Modify `own-measure.ts`; Test `own-measure.test.ts`

**Interfaces:**
- Consumes: `graphClient.fetchAccountBreakdowns` (A4), `OWN_AUDIENCE_FETCH_ERROR_KEY` (B1).
- Produces: a run writes an `own_account_breakdowns` batch and sets or clears `own_audience_fetch_error` when the newest batch is 24 hours old or more, 4 calls of budget remain, and the run did not stop early.

- [ ] **Step 1: Failing tests**

```ts
describe("account breakdowns", () => {
  const rows = [
    { metric: "views", dimension: "follower_type", key: "FOLLOWER", value: 30, timeframe: "day" },
    { metric: "engaged_audience_demographics", dimension: "age", key: "25-34", value: 40, timeframe: "this_month" },
  ];
  test("writes a batch once a day and stores a refusal in app_settings", async () => {
    graphClient.fetchAccountBreakdowns.mockResolvedValue({ rows, audienceError: "HTTP 400: not enough users", callsUsed: 2 });
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(await db.select().from(tables.ownAccountBreakdowns)).toHaveLength(2);
    const settings = await db.select().from(tables.appSettings);
    expect(settings.find((s) => s.key === "own_audience_fetch_error")?.value).toContain("not enough users");
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + H) });
    expect(graphClient.fetchAccountBreakdowns).toHaveBeenCalledTimes(1);
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + 25 * H) });
    expect(graphClient.fetchAccountBreakdowns).toHaveBeenCalledTimes(2);
  });
  test("a successful fetch clears a stored refusal", async () => {
    graphClient.fetchAccountBreakdowns.mockResolvedValue({ rows, audienceError: null, callsUsed: 4 });
    await db.insert(tables.appSettings).values({ key: "own_audience_fetch_error", value: "old" });
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect((await db.select().from(tables.appSettings)).some((s) => s.key === "own_audience_fetch_error")).toBe(false);
  });
});
```

- [ ] **Step 2: Run** -> FAIL (no breakdown rows).
- [ ] **Step 3: Implement** (after the post loop, before comments)

```ts
async function breakdownsStale(now: Date): Promise<boolean> {
  const [newest] = await db.select({ capturedAt: tables.ownAccountBreakdowns.capturedAt }).from(tables.ownAccountBreakdowns).orderBy(desc(tables.ownAccountBreakdowns.capturedAt)).limit(1);
  return !newest || now.getTime() - Date.parse(newest.capturedAt) >= 24 * HOUR_MS;
}
```

```ts
  // ponytail: when every breakdown call is refused no row lands, so this retries each
  // tick (4 calls an hour); store a refusal timestamp if that ever matters.
  if (stoppedEarly === null && callsUsed + 4 <= budget && (await breakdownsStale(now))) {
    try {
      const b = await graphClient.fetchAccountBreakdowns();
      callsUsed += b.callsUsed;
      if (b.rows.length > 0) {
        await db.insert(tables.ownAccountBreakdowns).values(b.rows.map((r) => ({ id: newId(), capturedAt: measuredAt, ...r })));
      }
      await setAppSetting(OWN_AUDIENCE_FETCH_ERROR_KEY, b.audienceError);
    } catch (err) {
      callsUsed += 1;
      if (err instanceof GraphApiError && err.code === "GRAPH_RATE_LIMITED") stoppedEarly = "rate_limited";
      log.warn("own_measure.breakdowns_failed", { error: messageOf(err) });
    }
  }
```

- [ ] **Step 4: Verify** -> PASS.
- [ ] **Step 5: Commit**: `git commit -am "feat(mine): daily account-wide breakdowns in the measurement"`

### Task B4: `measureOwnChannelAction` becomes a thin wrapper

**Files:**
- Modify: `src/server/actions/graph-actions.ts`, `src/server/actions/graph-actions.test.ts`, `src/server/graph/client.ts` (remove `fetchPosts`, `GraphPost`, `fetchPosts` in `GraphClient`), `src/server/graph/client.test.ts` (delete the `graphClient.fetchPosts` describe)

**Interfaces:**
- Consumes: `measureOwnChannel`, `toFailure` (B1).
- Produces: `measureOwnChannelAction(): Promise<MeasureResult>` (a superset of today's success fields; `GraphConnectPanel` reads `ok`, `error`, `postsMeasured`, `postsSeen`), calls `revalidatePath("/")` on success.

- [ ] **Step 1: Rewrite `graph-actions.test.ts`** (keep the two `checkGraphTokenAction` tests as they are; replace every `measureOwnChannelAction` test with the two below; drop the db setup if no remaining test needs it)

```ts
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const measureOwnChannel = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/own-measure", async (orig) => ({ ...(await orig<typeof import("@/server/services/own-measure")>()), measureOwnChannel }));

describe("measureOwnChannelAction", () => {
  test("ACTION-18: delegates with scope all and revalidates / on success, never /mine", async () => {
    measureOwnChannel.mockResolvedValue({ ok: true, measuredAt: "t", postsSeen: 1, postsMeasured: 1, postsFailed: 0, commentsSeen: 0, partial: false, callsUsed: 4, stoppedEarly: null });
    const { revalidatePath } = (await import("next/cache")) as unknown as { revalidatePath: ReturnType<typeof vi.fn> };
    const r = await measureOwnChannelAction();
    expect(measureOwnChannel).toHaveBeenCalledWith({ scope: "all" });
    expect(r).toMatchObject({ ok: true, postsMeasured: 1 });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).not.toHaveBeenCalledWith("/mine");
  });
  test("a failure is returned and nothing is revalidated", async () => {
    measureOwnChannel.mockResolvedValue({ ok: false, error: "bad token", code: "GRAPH_AUTH_FAILED" });
    const { revalidatePath } = (await import("next/cache")) as unknown as { revalidatePath: ReturnType<typeof vi.fn> };
    (revalidatePath as ReturnType<typeof vi.fn>).mockClear();
    expect(await measureOwnChannelAction()).toMatchObject({ ok: false, code: "GRAPH_AUTH_FAILED" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
```

(The `vi.mock("../graph/client", ...)` mock in this file stays for `checkGraphTokenAction`; remove `fetchPosts` from its hoisted object.)

- [ ] **Step 2: Run**: `npx vitest run src/server/actions/graph-actions.test.ts` -> FAIL (action does not call the service).

- [ ] **Step 3: Implement** `graph-actions.ts`, whole file:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { graphClient, type GraphTokenStatus } from "../graph/client";
import type { GraphErrorCode } from "../graph/errors";
import { measureOwnChannel, toFailure, type MeasureResult } from "../services/own-measure";

type ActionResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string; code?: GraphErrorCode | "GRAPH_UNKNOWN" };

/** "Measure now": every listed post, plus comments, through the one measurement service.
 *  Waits its turn when a scheduled run holds the lock. */
export async function measureOwnChannelAction(): Promise<MeasureResult> {
  const result = await measureOwnChannel({ scope: "all" });
  if (result.ok) revalidatePath("/");
  return result;
}

/** Cheapest authenticated call; never throws (see graphClient.checkToken). A not
 *  configured token is a successful "not_configured" answer, not a failure. */
export async function checkGraphTokenAction(): Promise<ActionResult<{ status: GraphTokenStatus }>> {
  try {
    const status = await graphClient.checkToken();
    return { ok: true, status };
  } catch (err) {
    return toFailure(err);
  }
}
```

Remove `fetchPosts` and `GraphPost` from `client.ts` and the `fetchPosts` describe from `client.test.ts`.

- [ ] **Step 4: Verify**: `npx vitest run src/server/actions/graph-actions.test.ts src/server/graph/client.test.ts src/server/services/own-measure.test.ts && npm run typecheck` -> PASS; `grep -rn "fetchPosts" src` -> no hits.
- [ ] **Step 5: Commit**: `git add src/server && git commit -m "refactor(mine): measure action is a wrapper over the measurement service"`

### Task B5: The scheduler and its boot

**Files:**
- Create: `src/server/services/own-measure-scheduler.ts`, `src/server/services/own-measure-scheduler.test.ts`
- Modify: `server.ts`, `.env.example`

**Interfaces:**
- Consumes: `measureOwnChannel` (B1), `getOwnChannel` (`queries/channels.ts`), `isGraphConfigured` (client).
- Produces: `runDueOwnMeasure(now?: Date, deps?: Partial<OwnMeasureSchedulerDeps>): Promise<OwnMeasureTickResult>`, `startOwnMeasureScheduler(deps?): () => void`.

- [ ] **Step 1: Failing test (ACTION-27)**

```ts
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { GraphApiError } from "@/server/graph/errors";

const graphClient = vi.hoisted(() => ({ fetchAccount: vi.fn(), fetchMedia: vi.fn(), fetchPostInsights: vi.fn(), fetchAccountBreakdowns: vi.fn(), fetchComments: vi.fn(), checkToken: vi.fn() }));
vi.mock("@/server/graph/client", () => ({ graphClient, CLASSIFIER_VERSION: "t", isGraphConfigured: () => false }));
process.env.CROWSNEST_DB_PATH = ":memory:";
process.env.IG_SERVICE_TOKEN ??= "test-token";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let runDueOwnMeasure: typeof import("./own-measure-scheduler")["runDueOwnMeasure"];

beforeAll(async () => {
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ runDueOwnMeasure } = await import("./own-measure-scheduler"));
});
beforeEach(async () => {
  migrate();
  for (const t of [tables.ownPostInsights, tables.ownPosts, tables.ownAccountSnapshots, tables.channels]) await db.delete(t);
  vi.clearAllMocks();
});

async function markOwn() {
  await db.insert(tables.channels).values({ id: "c1", platform: "instagram", handle: "@me", externalId: "e1", displayName: "Me", isVerified: false, isPrivate: false, trackedSince: "2026-09-01T00:00:00.000Z", isOwn: true });
}
const ownRows = async () => (await db.select().from(tables.ownAccountSnapshots)).length + (await db.select().from(tables.ownPosts)).length;

describe("runDueOwnMeasure", () => {
  test("no own channel: skipped, zero Graph calls", async () => {
    expect(await runDueOwnMeasure(new Date(), { configured: () => true })).toMatchObject({ ran: false, reason: "no_own_channel" });
    expect(graphClient.fetchAccount).not.toHaveBeenCalled();
    expect(await ownRows()).toBe(0);
  });
  test("no token: skipped, zero Graph calls", async () => {
    await markOwn();
    expect(await runDueOwnMeasure(new Date())).toMatchObject({ ran: false, reason: "not_configured" });
    expect(graphClient.fetchAccount).not.toHaveBeenCalled();
  });
  test("rejected token: one call, nothing written", async () => {
    await markOwn();
    graphClient.fetchAccount.mockRejectedValue(new GraphApiError("GRAPH_AUTH_FAILED", "bad"));
    expect(await runDueOwnMeasure(new Date(), { configured: () => true })).toMatchObject({ ran: true, reason: "failed" });
    expect(graphClient.fetchAccount).toHaveBeenCalledTimes(1);
    expect(await ownRows()).toBe(0);
  });
});
```

(Column names for `channels`: copy the insert shape from `scripts/seed-e2e.ts` lines 58 to 72 if the schema requires more non-null fields.)

- [ ] **Step 2: Run** -> FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import { log } from "@/server/lib/logger";
import { isGraphConfigured } from "@/server/graph/client";
import { getOwnChannel } from "@/server/queries/channels";
import { measureOwnChannel, messageOf, type MeasureResult } from "./own-measure";

/**
 * The in-process own-channel measurement scheduler, same shape as sync-scheduler.ts: one
 * setInterval, a `let running` guard, a tick that never throws, started once from
 * server.ts. It keeps no state: which posts are due is derived from stored captures.
 */

export interface OwnMeasureSchedulerDeps {
  hasOwnChannel: () => Promise<boolean>;
  configured: () => boolean;
  measure: (now: Date) => Promise<MeasureResult>;
}

const DEFAULT_DEPS: OwnMeasureSchedulerDeps = {
  hasOwnChannel: async () => (await getOwnChannel()) !== null,
  configured: isGraphConfigured,
  measure: (now) => measureOwnChannel({ scope: "due", now }),
};

export interface OwnMeasureTickResult {
  ran: boolean;
  reason: "no_own_channel" | "not_configured" | "busy" | "failed" | "done";
  callsUsed: number;
}

/** One tick. Never throws. Logs codes and counts only, never a message that could carry a token. */
export async function runDueOwnMeasure(now: Date = new Date(), deps: Partial<OwnMeasureSchedulerDeps> = {}): Promise<OwnMeasureTickResult> {
  const d: OwnMeasureSchedulerDeps = { ...DEFAULT_DEPS, ...deps };
  try {
    if (!(await d.hasOwnChannel())) return { ran: false, reason: "no_own_channel", callsUsed: 0 };
    if (!d.configured()) return { ran: false, reason: "not_configured", callsUsed: 0 };
    const result = await d.measure(now);
    if (!result.ok) {
      if (result.code === "MEASURE_BUSY") return { ran: false, reason: "busy", callsUsed: 0 };
      log.warn("own_measure_scheduler.failed", { code: result.code });
      return { ran: true, reason: "failed", callsUsed: 0 };
    }
    log.info("own_measure_scheduler.done", { postsMeasured: result.postsMeasured, postsFailed: result.postsFailed, callsUsed: result.callsUsed, stoppedEarly: result.stoppedEarly });
    return { ran: true, reason: "done", callsUsed: result.callsUsed };
  } catch (err) {
    log.error("own_measure_scheduler.tick_failed", { error: messageOf(err) });
    return { ran: false, reason: "failed", callsUsed: 0 };
  }
}

const DEFAULT_TICK_INTERVAL_MS = 3_600_000;
function resolveTickIntervalMs(): number {
  const parsed = Number(process.env.OWN_MEASURE_SCHEDULER_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TICK_INTERVAL_MS;
}

export function startOwnMeasureScheduler(deps: Partial<OwnMeasureSchedulerDeps> & { intervalMs?: number } = {}): () => void {
  const { intervalMs, ...schedulerDeps } = deps;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runDueOwnMeasure(new Date(), schedulerDeps).finally(() => {
      running = false;
    });
  }, intervalMs ?? resolveTickIntervalMs());
  return () => clearInterval(timer);
}
```

`server.ts`: add the import beside the other two and, after the sync scheduler block:

```ts
  // Start the own-channel measurement scheduler: hourly ticks measure reels under 72 hours
  // old every hour and older posts daily, under a 150-call budget (own-measure.ts). Same
  // guard: a scheduler that fails to start must never stop the server from listening.
  try {
    startOwnMeasureScheduler();
  } catch (err) {
    console.error("startOwnMeasureScheduler failed on boot:", err);
  }
```

`.env.example`, after `PUBLISH_SCHEDULER_INTERVAL_MS=`:

```
# Optional. How often the own-channel measurement scheduler ticks, in milliseconds.
# Defaults to 3600000 (one hour). Each tick measures only the posts that are due.
OWN_MEASURE_SCHEDULER_INTERVAL_MS=
```

- [ ] **Step 4: Verify**: `npx vitest run src/server/services/own-measure-scheduler.test.ts && npm run typecheck` -> PASS.
- [ ] **Step 5: Commit**: `git add src/server/services/own-measure-scheduler* server.ts .env.example && git commit -m "feat(mine): hourly scheduled measurement booted from server.ts"`

### Task B6: Security tests (SEC-04, SEC-05, SEC-06)

**Files:** Create `src/server/services/own-measure.security.test.ts`; Modify `src/server/graph/client.test.ts`

- [ ] **Step 1: Write the tests** (real client, stubbed `fetch`, no `vi.mock` of the client)

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

const TOKEN = "tok_SUPER_secret_123";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  process.env.IG_SERVICE_TOKEN ??= "test-token-long-enough";
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_GRAPH_TOKEN = TOKEN;
  process.env.IG_GRAPH_USER_ID = "17841400000000000";
});

async function load() {
  const { migrate } = await import("@/server/db/test-migrate");
  migrate();
  const { log } = await import("@/server/lib/logger");
  const logged: unknown[] = [];
  for (const level of ["debug", "info", "warn", "error"] as const) vi.spyOn(log, level).mockImplementation((...args: unknown[]) => { logged.push(args); });
  const svc = await import("./own-measure");
  return { svc, logged };
}

describe("own measurement security", () => {
  test("SEC-04: an error body echoing the token never reaches a log line or the result", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "a", username: "me" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{ id: "r1", media_type: "VIDEO", media_product_type: "REELS", permalink: "p", timestamp: "2026-09-01T00:00:00+0000" }] }) })
      .mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: { message: `bad token ${TOKEN}` } }) }));
    const { svc, logged } = await load();
    const r = await svc.measureOwnChannel({ scope: "all" });
    expect(JSON.stringify(logged)).not.toContain(TOKEN);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  test("SEC-06: every outbound request goes to graph.instagram.com", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "a", username: "me" }) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    const { svc } = await load();
    await svc.measureOwnChannel({ scope: "due" });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    for (const [url] of fetchMock.mock.calls) expect(new URL(url as string).host).toBe("graph.instagram.com");
  });
});
```

Append to `client.test.ts`:

```ts
describe("SEC-05: the Settings token wins over .env.local", () => {
  test("fetchAccount and checkToken send the db secret, not the env value", async () => {
    process.env.IG_GRAPH_TOKEN = "env_token_A";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "1", username: "me" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    const { setSecret } = await import("@/server/secrets/store");
    setSecret("IG_GRAPH_TOKEN", "settings_token_B");
    await graphClient.fetchAccount();
    await graphClient.checkToken();
    for (const [url] of fetchMock.mock.calls) expect(new URL(url as string).searchParams.get("access_token")).toBe("settings_token_B");
  });
});
```

- [ ] **Step 2: Run**: `npx vitest run src/server/services/own-measure.security.test.ts src/server/graph/client.test.ts`
Expected: PASS on first run (these pin existing redaction and secrets behavior through the new service). If SEC-04 fails, the leak is a `log.*` call in `own-measure.ts` passing an unredacted value: fix by logging `messageOf(err)` of a `GraphApiError` only (its message is already redacted in `graphRequest`).
- [ ] **Step 3: Commit**: `git add src/server && git commit -m "test(mine): token never logged, settings token wins, graph host only"`

---

## Phase C: queries and pure reel-insight functions

### Task C1: Rates, insight shaping, reel selection

**Files:** Create `src/server/services/reel-insights.ts`, `src/server/services/reel-insights.test.ts`

**Interfaces:**
- Produces (all exported from `reel-insights.ts`, no db, no network):

```ts
export interface OwnReelSnapshot {
  capturedAt: string; views: number | null; reach: number | null; likes: number | null; comments: number | null;
  shares: number | null; saved: number | null; reposts: number | null; followsFromPost: number | null;
  profileVisits: number | null; bioLinkTaps: number | null; avgWatchTimeMs: number | null; skipRate: number | null;
  fetchError: string | null;
}
export interface OwnReel { ownPostId: string; permalink: string; caption: string | null; postedAt: string; thumbnailUrl: string | null; latest: OwnReelSnapshot | null }
export interface InsightItem { label: string; value: number | null; unit?: "seconds" }
export interface RateItem { label: string; value: number | null; estimated: boolean }
export interface ShapedReelInsights { measuredAt: string; summary: InsightItem[]; interactions: InsightItem[]; impact: RateItem[]; actions: InsightItem[] }
export function perViewerRate(metric: number | null, reach: number | null): number | null
export function shapeReelInsights(s: OwnReelSnapshot): ShapedReelInsights
export function selectReel<T extends { ownPostId: string }>(reels: T[], param: string | undefined): T | null
```

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, test } from "vitest";
import { perViewerRate, selectReel, shapeReelInsights, type OwnReelSnapshot } from "./reel-insights";

const SNAP: OwnReelSnapshot = { capturedAt: "2026-09-29T10:00:00.000Z", views: 120000, reach: 80997, likes: 900, comments: 40, shares: 1112, saved: 300, reposts: 20, followsFromPost: 12, profileVisits: 50, bioLinkTaps: 7, avgWatchTimeMs: 4500, skipRate: 0.42, fetchError: null };

describe("perViewerRate (ACTION-20)", () => {
  test("metric over reach; null when reach is 0 or null or the metric is null", () => {
    expect(perViewerRate(1112, 80997)).toBeCloseTo(0.01373, 4);
    expect(perViewerRate(5, 0)).toBeNull();
    expect(perViewerRate(5, null)).toBeNull();
    expect(perViewerRate(null, 100)).toBeNull();
  });
});

describe("shapeReelInsights (ACTION-21)", () => {
  test("blocks in the Instagram app's order, watch time in seconds, skip rate passed through as estimated", () => {
    const s = shapeReelInsights(SNAP);
    expect(s.summary.map((i) => i.label)).toEqual(["Views", "Viewers", "Average watch time", "Follows"]);
    expect(s.summary[2]).toEqual({ label: "Average watch time", value: 4.5, unit: "seconds" });
    expect(s.interactions.map((i) => i.label)).toEqual(["Likes", "Comments", "Reposts", "Shares", "Saves"]);
    expect(s.impact.map((i) => i.label)).toEqual(["Skip rate", "Share rate", "Like rate", "Save rate", "Repost rate", "Comment rate"]);
    expect(s.impact[0]).toEqual({ label: "Skip rate", value: 0.42, estimated: true });
    expect(s.impact.slice(1).every((i) => !i.estimated)).toBe(true);
    expect(s.actions.map((i) => i.label)).toEqual(["Follows", "Profile visits", "Bio link taps"]);
  });
  test("reach 0 makes every derived rate null but keeps skip rate", () => {
    const s = shapeReelInsights({ ...SNAP, reach: 0 });
    expect(s.impact.slice(1).every((i) => i.value === null)).toBe(true);
    expect(s.impact[0].value).toBe(0.42);
  });
});

describe("selectReel (ACTION-19 fallback)", () => {
  const reels = [{ ownPostId: "newest" }, { ownPostId: "second" }];
  test("the param when it matches, else the newest, else null", () => {
    expect(selectReel(reels, "second")?.ownPostId).toBe("second");
    expect(selectReel(reels, undefined)?.ownPostId).toBe("newest");
    expect(selectReel(reels, "does-not-exist")?.ownPostId).toBe("newest");
    expect(selectReel([], "x")).toBeNull();
  });
});
```

- [ ] **Step 2: Run**: `npx vitest run src/server/services/reel-insights.test.ts` -> FAIL.
- [ ] **Step 3: Implement**

```ts
/**
 * Pure reel-insight shaping for the My reels tab: no database, no network. Rates are per
 * viewer (metric / reach) and are null, never 0, when either side is missing or reach is 0.
 */

export function perViewerRate(metric: number | null, reach: number | null): number | null {
  if (metric === null || reach === null || reach === 0) return null;
  return metric / reach;
}

export function shapeReelInsights(s: OwnReelSnapshot): ShapedReelInsights {
  return {
    measuredAt: s.capturedAt,
    summary: [
      { label: "Views", value: s.views },
      { label: "Viewers", value: s.reach },
      { label: "Average watch time", value: s.avgWatchTimeMs === null ? null : s.avgWatchTimeMs / 1000, unit: "seconds" },
      { label: "Follows", value: s.followsFromPost },
    ],
    interactions: [
      { label: "Likes", value: s.likes },
      { label: "Comments", value: s.comments },
      { label: "Reposts", value: s.reposts },
      { label: "Shares", value: s.shares },
      { label: "Saves", value: s.saved },
    ],
    // The Instagram app's order of importance to reach. Skip rate is the API's own value,
    // flagged estimated because Meta marks the metric as in development.
    impact: [
      { label: "Skip rate", value: s.skipRate, estimated: true },
      { label: "Share rate", value: perViewerRate(s.shares, s.reach), estimated: false },
      { label: "Like rate", value: perViewerRate(s.likes, s.reach), estimated: false },
      { label: "Save rate", value: perViewerRate(s.saved, s.reach), estimated: false },
      { label: "Repost rate", value: perViewerRate(s.reposts, s.reach), estimated: false },
      { label: "Comment rate", value: perViewerRate(s.comments, s.reach), estimated: false },
    ],
    actions: [
      { label: "Follows", value: s.followsFromPost },
      { label: "Profile visits", value: s.profileVisits },
      { label: "Bio link taps", value: s.bioLinkTaps },
    ],
  };
}

export function selectReel<T extends { ownPostId: string }>(reels: T[], param: string | undefined): T | null {
  return reels.find((r) => r.ownPostId === param) ?? reels[0] ?? null;
}
```

(plus the interfaces from the Interfaces block)

- [ ] **Step 4: Verify** -> PASS.
- [ ] **Step 5: Commit**: `git add src/server/services/reel-insights* && git commit -m "feat(mine): per-viewer rates and reel insight shaping"`

### Task C2: Whole-hour buckets and the typical-reel curve

**Files:** Modify `reel-insights.ts`, `reel-insights.test.ts`

**Interfaces:**
- Consumes: `median` from `src/server/services/outlier-calc.ts` (pure; confirm the file has no db import before importing).
- Produces: `export interface ReelSnapshotPoint { ownPostId: string; postedAt: string; capturedAt: string; views: number | null }`, `export interface ViewsPoint { hour: number; views: number | null; typical: number | null }`, `hoursSincePosted(postedAt, capturedAt): number`, `typicalViewsCurve(selectedId: string, history: ReelSnapshotPoint[]): ViewsPoint[]`.

- [ ] **Step 1: Failing test (ACTION-24)**

```ts
describe("typicalViewsCurve (ACTION-24)", () => {
  const T = Date.parse("2026-09-20T00:00:00.000Z");
  const at = (ms: number) => new Date(T + ms).toISOString();
  const H = 3_600_000;
  const posted = at(0);
  const history = [
    { ownPostId: "A", postedAt: posted, capturedAt: at(H + 10 * 60_000), views: 100 },
    { ownPostId: "A", postedAt: posted, capturedAt: at(2 * H), views: 180 },
    { ownPostId: "A", postedAt: posted, capturedAt: at(5 * H), views: 400 },
    { ownPostId: "B", postedAt: posted, capturedAt: at(H), views: 50 },
    { ownPostId: "B", postedAt: posted, capturedAt: at(2 * H), views: 70 },
    { ownPostId: "C", postedAt: posted, capturedAt: at(H + 30 * 60_000), views: 90 },
    { ownPostId: "C", postedAt: posted, capturedAt: at(2 * H + 59 * 60_000), views: 110 },
  ];
  test("real points only, whole hours, median of the other reels, gap where none measured", () => {
    expect(typicalViewsCurve("A", history)).toEqual([
      { hour: 1, views: 100, typical: 70 },
      { hour: 2, views: 180, typical: 90 },
      { hour: 5, views: 400, typical: null },
    ]);
  });
  test("the latest snapshot in an hour bucket wins; the selected reel never feeds its own line", () => {
    const dup = [...history, { ownPostId: "B", postedAt: posted, capturedAt: at(H + 50 * 60_000), views: 60 }];
    expect(typicalViewsCurve("A", dup)[0]).toEqual({ hour: 1, views: 100, typical: 75 });
    expect(typicalViewsCurve("B", history).every((p) => p.views === null || [50, 70].includes(p.views))).toBe(true);
  });
  test("no snapshots for the selected reel yields no points", () => {
    expect(typicalViewsCurve("Z", history)).toEqual([]);
  });
  test("hoursSincePosted floors", () => {
    expect(hoursSincePosted(posted, at(H + 59 * 60_000))).toBe(1);
  });
});
```

- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement**

```ts
import { median } from "./outlier-calc";

const HOUR_MS = 3_600_000;

export function hoursSincePosted(postedAt: string, capturedAt: string): number {
  return Math.floor((Date.parse(capturedAt) - Date.parse(postedAt)) / HOUR_MS);
}

/**
 * The selected reel's views by whole hour since posting, next to the median of every OTHER
 * reel measured at that same hour. Only real snapshots become points; hours run 0 to the
 * selected reel's newest measured hour, so the payload is bounded by that reel's age.
 */
export function typicalViewsCurve(selectedId: string, history: ReelSnapshotPoint[]): ViewsPoint[] {
  const byReel = new Map<string, Map<number, { capturedAt: string; views: number }>>();
  for (const s of history) {
    if (s.views === null) continue;
    const hour = hoursSincePosted(s.postedAt, s.capturedAt);
    if (hour < 0) continue;
    let buckets = byReel.get(s.ownPostId);
    if (!buckets) byReel.set(s.ownPostId, (buckets = new Map()));
    const prev = buckets.get(hour);
    if (!prev || s.capturedAt > prev.capturedAt) buckets.set(hour, { capturedAt: s.capturedAt, views: s.views });
  }
  const own = byReel.get(selectedId);
  if (!own || own.size === 0) return [];
  const maxHour = Math.max(...own.keys());
  const points: ViewsPoint[] = [];
  for (let hour = 0; hour <= maxHour; hour++) {
    const others: number[] = [];
    for (const [id, buckets] of byReel) {
      const b = id === selectedId ? undefined : buckets.get(hour);
      if (b) others.push(b.views);
    }
    const views = own.get(hour)?.views ?? null;
    const typical = others.length > 0 ? median(others) : null;
    if (views !== null || typical !== null) points.push({ hour, views, typical });
  }
  return points;
}
```

- [ ] **Step 4: Verify** -> PASS.
- [ ] **Step 5: Commit**: `git commit -am "feat(mine): typical-reel median curve by whole hours since posting"`

### Task C3: Reel, history, and breakdown reads; `WIRED` flip

**Files:** Modify `src/server/queries/own-channel.ts`, `src/server/queries/own-channel.test.ts`

**Interfaces:**
- Consumes: `OwnReel`, `OwnReelSnapshot`, `ReelSnapshotPoint` types (C1, C2), `OWN_AUDIENCE_FETCH_ERROR_KEY` (B1).
- Produces:
  - `getOwnReels(): Promise<OwnReel[]>` (reels only, newest first, latest snapshot each)
  - `getReelViewHistory(): Promise<ReelSnapshotPoint[]>` (every reel snapshot)
  - `export interface BreakdownEntry { key: string; value: number }`; `export interface AccountBreakdowns { followerSplit: BreakdownEntry[]; followerSplitAt: string | null; audience: { age: BreakdownEntry[]; country: BreakdownEntry[]; gender: BreakdownEntry[] }; audienceAt: string | null; audienceError: string | null }`; `getAccountBreakdowns(): Promise<AccountBreakdowns>`
  - `WIRED.profileVisits` and `WIRED.followsFromPost` become `true` (`watchTimeSec` stays `false`).

- [ ] **Step 1: Failing tests** (update the existing "unwired metrics ... always report wired: false" test to expect `profileVisits` and `followsFromPost` `true`, `watchTimeSec` `false`, and rename it; add)

```ts
describe("getOwnReels (ACTION-19)", () => {
  test("reels only, newest first, views from the latest snapshot", async () => {
    const post = (id: string, productType: string, postedAt: string) => db.insert(tables.ownPosts).values({ id, externalId: `x-${id}`, permalink: `https://i/${id}`, mediaType: "VIDEO", productType, format: "Reel", postedAt, firstSeenAt: postedAt, thumbnailUrl: `https://cdn/${id}` });
    const snap = (ownPostId: string, capturedAt: string, views: number) => db.insert(tables.ownPostInsights).values({ id: `${ownPostId}-${capturedAt}`, ownPostId, capturedAt, views });
    await post("r1", "REELS", "2026-09-01T00:00:00.000Z");
    await post("r2", "REELS", "2026-09-10T00:00:00.000Z");
    await post("r3", "REELS", "2026-09-20T00:00:00.000Z");
    await post("c1", "FEED", "2026-09-25T00:00:00.000Z");
    for (const id of ["r1", "r2", "r3"]) { await snap(id, "2026-09-26T00:00:00.000Z", 10); await snap(id, "2026-09-27T00:00:00.000Z", 20); }
    const reels = await getOwnReels();
    expect(reels.map((r) => r.ownPostId)).toEqual(["r3", "r2", "r1"]);
    expect(reels.every((r) => r.latest?.views === 20)).toBe(true);
    expect(reels[0].thumbnailUrl).toBe("https://cdn/r3");
    expect((await getReelViewHistory()).filter((h) => h.ownPostId === "r1")).toHaveLength(2);
    expect((await getReelViewHistory()).some((h) => h.ownPostId === "c1")).toBe(false);
  });
});

describe("getAccountBreakdowns", () => {
  test("newest batch per metric, sorted by value, with the stored refusal", async () => {
    const row = (id: string, capturedAt: string, metric: string, dimension: string, key: string, value: number) => ({ id, capturedAt, metric, dimension, key, value, timeframe: null });
    await db.insert(tables.ownAccountBreakdowns).values([
      row("1", "2026-09-27T00:00:00.000Z", "views", "follower_type", "FOLLOWER", 1),
      row("2", "2026-09-28T00:00:00.000Z", "views", "follower_type", "FOLLOWER", 30),
      row("3", "2026-09-28T00:00:00.000Z", "views", "follower_type", "NON_FOLLOWER", 70),
      row("4", "2026-09-28T00:00:00.000Z", "engaged_audience_demographics", "age", "18-24", 20),
      row("5", "2026-09-28T00:00:00.000Z", "engaged_audience_demographics", "age", "25-34", 40),
    ]);
    await db.insert(tables.appSettings).values({ key: "own_audience_fetch_error", value: "not enough users" });
    const b = await getAccountBreakdowns();
    expect(b.followerSplit).toEqual([{ key: "NON_FOLLOWER", value: 70 }, { key: "FOLLOWER", value: 30 }]);
    expect(b.audience.age.map((a) => a.key)).toEqual(["25-34", "18-24"]);
    expect(b.audience.country).toEqual([]);
    expect(b.audienceError).toBe("not enough users");
    expect(b.followerSplitAt).toBe("2026-09-28T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement** (add `import type { OwnReel, ReelSnapshotPoint } from "@/server/services/reel-insights";`)

```ts
export async function getOwnReels(): Promise<OwnReel[]> {
  const reels = await db.select().from(tables.ownPosts).where(eq(tables.ownPosts.productType, "REELS")).orderBy(desc(tables.ownPosts.postedAt));
  if (reels.length === 0) return [];
  const rows = await db
    .select()
    .from(tables.ownPostInsights)
    .where(inArray(tables.ownPostInsights.ownPostId, reels.map((r) => r.id)))
    .orderBy(desc(tables.ownPostInsights.capturedAt));
  const latest = new Map<string, OwnPostInsightsRow>();
  for (const r of rows) if (!latest.has(r.ownPostId)) latest.set(r.ownPostId, r);
  return reels.map((p) => {
    const l = latest.get(p.id);
    return {
      ownPostId: p.id, permalink: p.permalink, caption: p.caption, postedAt: p.postedAt, thumbnailUrl: p.thumbnailUrl,
      latest: l
        ? {
            capturedAt: l.capturedAt, views: l.views, reach: l.reach, likes: l.likes, comments: l.comments, shares: l.shares,
            saved: l.saved, reposts: l.reposts, followsFromPost: l.followsFromPost, profileVisits: l.profileVisits,
            bioLinkTaps: l.bioLinkTaps, avgWatchTimeMs: l.avgWatchTimeMs, skipRate: l.skipRate, fetchError: l.fetchError,
          }
        : null,
    };
  });
}

/** Every reel snapshot as (ownPostId, postedAt, capturedAt, views): the input to typicalViewsCurve. */
export async function getReelViewHistory(): Promise<ReelSnapshotPoint[]> {
  return db
    .select({ ownPostId: tables.ownPostInsights.ownPostId, postedAt: tables.ownPosts.postedAt, capturedAt: tables.ownPostInsights.capturedAt, views: tables.ownPostInsights.views })
    .from(tables.ownPostInsights)
    .innerJoin(tables.ownPosts, eq(tables.ownPosts.id, tables.ownPostInsights.ownPostId))
    .where(eq(tables.ownPosts.productType, "REELS"));
}

export async function getAccountBreakdowns(): Promise<AccountBreakdowns> {
  // ponytail: reads every stored batch and keeps the newest per metric in memory; a
  // single-user account adds a few dozen rows a day. Filter in SQL if that ever shows.
  const [rows, errorRow] = await Promise.all([
    db.select().from(tables.ownAccountBreakdowns).orderBy(desc(tables.ownAccountBreakdowns.capturedAt)),
    db.select().from(tables.appSettings).where(eq(tables.appSettings.key, OWN_AUDIENCE_FETCH_ERROR_KEY)).limit(1),
  ]);
  const newest = (metric: string) => {
    const first = rows.find((r) => r.metric === metric);
    return first ? rows.filter((r) => r.metric === metric && r.capturedAt === first.capturedAt) : [];
  };
  const entries = (list: typeof rows) => list.map((r) => ({ key: r.key, value: r.value })).sort((a, b) => b.value - a.value);
  const split = newest("views");
  const audience = newest("engaged_audience_demographics");
  const dim = (d: string) => entries(audience.filter((r) => r.dimension === d));
  return {
    followerSplit: entries(split),
    followerSplitAt: split[0]?.capturedAt ?? null,
    audience: { age: dim("age"), country: dim("country"), gender: dim("gender") },
    audienceAt: audience[0]?.capturedAt ?? null,
    audienceError: errorRow[0]?.value ?? null,
  };
}
```

`WIRED`: set `profileVisits: true, followsFromPost: true`; update the comment on `OwnMetric.wired` if it names these as unrequested.

- [ ] **Step 4: Verify**: `npx vitest run src/server/queries/own-channel.test.ts && npm run test -- src/server/mcp` -> PASS (MCP tests may snapshot `wired`; update the expectation to `true` for the two metrics if so).
- [ ] **Step 5: Commit**: `git commit -am "feat(mine): reel, view-history, and account breakdown reads"`

---

## Phase D: Dashboard tabs, redirect, nav, revalidation, month links

### Task D1: `CalendarTab` and month links that keep `tab=calendar`

**Files:**
- Create: `src/components/mine/month-param.ts`, `src/components/mine/month-param.test.ts`, `src/components/mine/calendar-tab.tsx`
- Modify: `src/components/mine/mine-calendar.tsx:304,315,319`, `src/components/mine/mine-calendar.test.tsx`

**Interfaces:**
- Produces: `validMonth(raw: unknown): string | null`; `mineRedirectTarget(params: { month?: string | string[] }): string`; `CalendarTab({ month }: { month?: string }): Promise<JSX.Element>`; `ownChannelPicker(): Promise<JSX.Element>`.

- [ ] **Step 1: Failing tests**

`month-param.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { mineRedirectTarget, validMonth } from "./month-param";

describe("validMonth", () => {
  test("accepts YYYY-MM with a real month only", () => {
    expect(validMonth("2026-08")).toBe("2026-08");
    for (const bad of ["2026-13", "junk", "<script>", undefined, ["2026-08"]]) expect(validMonth(bad)).toBeNull();
  });
});

describe("mineRedirectTarget (ACTION-16, SEC-07)", () => {
  test("carries only a valid month, always to the same-origin Calendar tab", () => {
    expect(mineRedirectTarget({})).toBe("/?tab=calendar");
    expect(mineRedirectTarget({ month: "2026-08" })).toBe("/?tab=calendar&month=2026-08");
    expect(mineRedirectTarget({ month: "junk" })).toBe("/?tab=calendar");
    expect(mineRedirectTarget({ month: "2026-08", reel: "x", next: "https://evil.example" } as { month: string })).toBe("/?tab=calendar&month=2026-08");
  });
});
```

`mine-calendar.test.tsx`, a new test using the file's existing render setup:

```ts
test("MINE-19: month controls keep tab=calendar", () => {
  renderCalendar(); // use the file's existing render helper / props fixture for month "2026-08"
  expect(screen.getByLabelText("Previous month").getAttribute("href")).toBe("?tab=calendar&month=2026-07");
  expect(screen.getByLabelText("Next month").getAttribute("href")).toBe("?tab=calendar&month=2026-09");
});
```

(If the file has no `renderCalendar` helper, inline the same `render(<MineCalendar month="2026-08" ... />)` call its first test uses.)

- [ ] **Step 2: Run**: `npx vitest run src/components/mine/month-param.test.ts src/components/mine/mine-calendar.test.tsx` -> FAIL.

- [ ] **Step 3: Implement**

`month-param.ts`:

```ts
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function validMonth(raw: unknown): string | null {
  return typeof raw === "string" && MONTH_RE.test(raw) ? raw : null;
}

/** Where an old /mine link lands: the Calendar tab, carrying only a valid month. A path,
 *  never a full URL, so no param can steer it off-site. */
export function mineRedirectTarget(params: { month?: string | string[] }): string {
  const month = validMonth(params.month);
  return month ? `/?tab=calendar&month=${month}` : "/?tab=calendar";
}
```

`mine-calendar.tsx`: the three month links become `` `?tab=calendar&month=${...}` `` (previous, next, today).

`calendar-tab.tsx` (server component, moves `MinePage`'s calendar half as-is):

```tsx
import { MineCalendar } from "./mine-calendar";
import { OwnChannelPicker } from "./own-channel-picker";
import { validMonth } from "./month-param";
import { isGraphConfigured } from "@/server/graph/client";
import { getStorageProvider } from "@/server/publish/storage-provider";
import { getChannelsList, getOwnChannel } from "@/server/queries/channels";
import { getCalendarMonth } from "@/server/queries/planned-posts";
import { getScripts } from "@/server/queries/vault";

/** The no-own-channel gate, shared by the Calendar and My reels tabs. */
export async function ownChannelPicker() {
  const channels = await getChannelsList();
  const candidates = channels
    .filter((c) => !c.isOwn)
    .map((c) => ({ id: c.id, handle: c.handle, displayName: c.displayName, followerCount: c.followerCount }));
  return <OwnChannelPicker candidates={candidates} />;
}

export async function CalendarTab({ month: monthParam }: { month?: string }) {
  const month = validMonth(monthParam) ?? new Date().toISOString().slice(0, 7);
  if (!(await getOwnChannel())) return ownChannelPicker();

  const [calendar, scripts] = await Promise.all([getCalendarMonth(month), getScripts()]);
  // Publish honesty (publish component): the dialog offers a real publish only when both
  // seams are configured. Mirrors envDefaultsDryRun() in publish-post.ts.
  const bucketConfigured = getStorageProvider() !== null;
  const graphConfigured = isGraphConfigured();
  const publishDryRun = process.env.PUBLISH_DRY_RUN === "1" || (process.env.PUBLISH_DRY_RUN === undefined && process.env.NODE_ENV !== "production");

  return (
    <MineCalendar
      month={month}
      calendar={calendar}
      scripts={scripts.map((s) => ({ id: s.id, title: s.title }))}
      graphConfigured={graphConfigured}
      bucketConfigured={bucketConfigured}
      dryRun={publishDryRun}
    />
  );
}
```

- [ ] **Step 4: Verify**: both test files PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit**: `git add src/components/mine && git commit -m "feat(mine): Calendar tab component and month links that keep the tab"`

### Task D2: `MyReelsTab` (shipped account summary, posts, weekday)

**Files:** Create `src/components/mine/my-reels-tab.tsx`

**Interfaces:**
- Consumes: `ownChannelPicker` (D1), `checkGraphTokenAction`, `getOwnChannelOverview`, `getOwnPosts`, `getSetting`, `GraphConnectPanel`, `OwnStatTiles`, `ReachByPostBars`, `OwnPostList`, `OwnWeekdayRhythm`.
- Produces: `MyReelsTab(): Promise<JSX.Element>` (E2 adds the `reel` prop).

- [ ] **Step 1: Implement** by moving `MinePage`'s header, the two-gate stacking block, and the Posts and Metrics contents out of `mine/page.tsx` (the page itself is replaced in D4; do not delete it here):

```tsx
import { GraphConnectPanel } from "./graph-connect-panel";
import { OwnPostList, ReachByPostBars } from "./reach-by-post-bars";
import { OwnStatTiles } from "./own-stat-tiles";
import { OwnWeekdayRhythm } from "./own-weekday-rhythm";
import { ownChannelPicker } from "./calendar-tab";
import { relativeTime } from "@/lib/format";
import { checkGraphTokenAction } from "@/server/actions/graph-actions";
import { getOwnChannel } from "@/server/queries/channels";
import { getOwnChannelOverview, getOwnPosts } from "@/server/queries/own-channel";
import { getSetting } from "@/server/settings";

/**
 * My reels. Two gates, neither faked: no own channel shows the picker; a token that is
 * missing or failing shows the connect panel, stacked over real historical numbers when
 * the account was measured before.
 */
export async function MyReelsTab() {
  const ownChannel = await getOwnChannel();
  if (!ownChannel) return ownChannelPicker();

  const [tokenResult, overview, ownPosts, minUsablePosts] = await Promise.all([
    checkGraphTokenAction(),
    getOwnChannelOverview(),
    getOwnPosts({ limit: 100 }),
    getSetting("scoreMinUsablePosts"),
  ]);
  const tokenStatus = tokenResult.ok
    ? tokenResult.status
    : { configured: false, username: null, state: "unknown" as const, message: tokenResult.error, checkedAt: new Date().toISOString() };
  const everMeasured = overview.account !== null;
  const connected = tokenStatus.state === "ok" && everMeasured;
  const panelOnly = !tokenStatus.configured || (!connected && !everMeasured);
  const progressPct = Math.min(100, (ownPosts.total / Math.max(1, minUsablePosts)) * 100);

  return (
    <div className="flex flex-col gap-10">
      {/* header: copy verbatim from MinePage (h2 handle + mono "Graph API · synced ..." line) */}
      {panelOnly ? (
        <GraphConnectPanel ownHandle={ownChannel.handle} initialStatus={tokenStatus} everMeasured={everMeasured} />
      ) : (
        <div className="flex flex-col gap-6">
          {!connected && <GraphConnectPanel ownHandle={ownChannel.handle} initialStatus={tokenStatus} everMeasured={everMeasured} />}
          <OwnStatTiles overview={overview} />
          {/* progress line: copy verbatim from MinePage */}
          <ReachByPostBars posts={ownPosts.items} />
        </div>
      )}
      <section className="flex flex-col gap-4">
        <h3 className="text-lg font-medium">Posts</h3>
        <OwnPostList posts={ownPosts.items} />
      </section>
      <section className="flex flex-col gap-4">
        <h3 className="text-lg font-medium">Average reach by weekday</h3>
        <OwnWeekdayRhythm posts={ownPosts.items} />
      </section>
    </div>
  );
}
```

(Replace the two `copy verbatim` comments with the exact JSX from `mine/page.tsx` lines 100 to 110 and 135 to 144; `relativeTime` is used by the header.)

- [ ] **Step 2: Verify**: `npm run typecheck && npm run lint` -> clean (the component is rendered from D3; behavior is verified in D3 and F).
- [ ] **Step 3: Commit**: `git add src/components/mine/my-reels-tab.tsx && git commit -m "feat(mine): My reels tab with the account summary, posts, and weekday sections"`

### Task D3: Dashboard tab strip, Overview move, tabbed `DashboardPage`

**Files:**
- Create: `src/components/dashboard/dashboard-tabs.tsx`, `src/components/dashboard/dashboard-tabs.test.ts`, `src/components/dashboard/overview-tab.tsx`
- Modify: `src/app/(shell)/(loaded)/page.tsx`

**Interfaces:**
- Produces: `export type DashboardTab = "overview" | "reels" | "calendar"`; `resolveDashboardTab(raw: string | string[] | undefined): DashboardTab`; `DashboardTabs({ active }: { active: DashboardTab })`; `OverviewTab(): Promise<JSX.Element>`.

- [ ] **Step 1: Failing test (ACTION-17)**

```ts
import { describe, expect, test } from "vitest";
import { resolveDashboardTab } from "./dashboard-tabs";

describe("resolveDashboardTab", () => {
  test("overview, reels, calendar; anything else is overview", () => {
    expect([undefined, "reels", "calendar", "REELS", "x", ["reels"]].map((v) => resolveDashboardTab(v as string | undefined))).toEqual(["overview", "reels", "calendar", "overview", "overview", "overview"]);
  });
});
```

- [ ] **Step 2: Run** -> FAIL.

- [ ] **Step 3: Implement**

`dashboard-tabs.tsx` (server component, no hooks):

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

export type DashboardTab = "overview" | "reels" | "calendar";

export function resolveDashboardTab(raw: string | string[] | undefined): DashboardTab {
  return raw === "reels" || raw === "calendar" ? raw : "overview";
}

const TABS: { id: DashboardTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "reels", label: "My reels" },
  { id: "calendar", label: "Calendar" },
];

/** Links, not client tabs: the tab lives in ?tab= so a reload or shared link lands on it,
 *  and the server renders only that tab's reads. */
export function DashboardTabs({ active }: { active: DashboardTab }) {
  return (
    <nav aria-label="Dashboard sections" className="flex flex-wrap gap-2">
      {TABS.map((t) => (
        <Button
          key={t.id}
          size="sm"
          variant={t.id === active ? "secondary" : "ghost"}
          aria-current={t.id === active ? "page" : undefined}
          data-testid={`dashboard-tab-${t.id}`}
          render={<Link href={`/?tab=${t.id}`} />}
        >
          {t.label}
        </Button>
      ))}
    </nav>
  );
}
```

`overview-tab.tsx`: move everything from today's `page.tsx` (imports, `LLM_PROXY_URL`, the `Promise.all` of twelve reads, `readAndBumpDashboardLastVisit`, both return branches, and the long header comment) into `export async function OverviewTab()`. Two changes only: the empty branch returns `<>...StackHealthPanel...Empty...</>` instead of wrapping in `PageContainer`, and the main branch returns `<div className="flex flex-col gap-16">` instead of `<PageContainer className="flex flex-col gap-16">`.

`page.tsx`, whole file:

```tsx
import { CalendarTab } from "@/components/mine/calendar-tab";
import { DashboardTabs, resolveDashboardTab } from "@/components/dashboard/dashboard-tabs";
import { MyReelsTab } from "@/components/mine/my-reels-tab";
import { OverviewTab } from "@/components/dashboard/overview-tab";
import { PageContainer } from "@/components/layout/page-container";

// Numbers reflect the live local db on every visit; never prerender.
export const dynamic = "force-dynamic";

/**
 * The Dashboard: three tabs held in ?tab=. Only the active tab's server component runs,
 * so Overview's sidecar and model pings never run on My reels, and Overview never reads
 * the own-channel tables. readAndBumpDashboardLastVisit lives in OverviewTab alone.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ tab?: string; month?: string; reel?: string }> }) {
  const { tab: rawTab, month } = await searchParams;
  const tab = resolveDashboardTab(rawTab);
  return (
    <PageContainer className="flex flex-col gap-8">
      <DashboardTabs active={tab} />
      {tab === "overview" && <OverviewTab />}
      {tab === "reels" && <MyReelsTab />}
      {tab === "calendar" && <CalendarTab month={month} />}
    </PageContainer>
  );
}
```

- [ ] **Step 4: Verify**: `npx vitest run src/components/dashboard && npm run typecheck && npm run lint` -> clean. Then `npm run dev` (port 3001, `localhost` not `127.0.0.1`), open `/`, `/?tab=reels`, `/?tab=calendar`, `/?tab=nonsense`: strip visible on each, Overview looks as before.
- [ ] **Step 5: Commit**: `git add src/components/dashboard "src/app/(shell)/(loaded)/page.tsx" && git commit -m "feat(dashboard): Overview, My reels, and Calendar tabs held in ?tab="`

### Task D4: `/mine` redirect, nav, and topbar cleanup

**Files:** Modify `src/app/(shell)/(loaded)/mine/page.tsx`, `src/components/layout/nav-items.ts`, `src/components/layout/topbar.tsx:38`

- [ ] **Step 1: Replace `mine/page.tsx`** (read `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md` first)

```tsx
import { redirect } from "next/navigation";
import { mineRedirectTarget } from "@/components/mine/month-param";

/** /mine moved onto the Dashboard. Every inbound link (remix finish, vault script dialog)
 *  is about the plan, so it lands on the Calendar tab, keeping a valid month. */
export default async function MinePage({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  redirect(mineRedirectTarget(await searchParams));
}
```

- [ ] **Step 2: Nav**: delete the `{ href: "/mine", label: "My channel", ... }` entry and the now-unused `UserRound` import in `nav-items.ts`; in its doc comment, replace the sentence `"My channel" is a real route (\`/mine\`) and lives here.` with `The own-account views are Dashboard tabs, not a separate entry.` Delete the `{ pattern: /^\/mine$/, title: "My channel" }` row in `topbar.tsx` (orphaned by the redirect).

- [ ] **Step 3: Verify**: `npx vitest run src/components/layout && npm run typecheck && npm run lint` -> PASS. `curl -sI "http://localhost:3001/mine?month=2026-08&next=https://evil.example"` -> `location: /?tab=calendar&month=2026-08`.
- [ ] **Step 4: Commit**: `git add "src/app/(shell)/(loaded)/mine/page.tsx" src/components/layout && git commit -m "feat(mine): /mine redirects to the Calendar tab and leaves the sidebar"`

### Task D5: Planner writes revalidate `/`

**Files:** Modify `src/server/actions/planned-post-actions.ts:391,409,464,483,522,543`, `src/server/actions/planned-post-actions.test.ts`

- [ ] **Step 1: Failing test** (the file already mocks `next/cache`; reuse its fixtures for a scheduled plan)

```ts
describe("ACTION-18: publish lifecycle writes revalidate /", () => {
  test("setPlanCaptionAction and cancelScheduledPublishAction revalidate / and never /mine", async () => {
    const { revalidatePath } = (await import("next/cache")) as unknown as { revalidatePath: ReturnType<typeof vi.fn> };
    const created = await createPlannedPostAction({ title: "Plan", plannedDate: "2026-12-01" });
    if (!created.ok) throw new Error(created.error);
    revalidatePath.mockClear();
    await setPlanCaptionAction(created.id, "caption");
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).not.toHaveBeenCalledWith("/mine");
  });
});
```

(Import `setPlanCaptionAction` alongside the actions the file already imports; if `createPlannedPostAction`'s success shape differs, follow the file's existing create helper.)

- [ ] **Step 2: Run** -> FAIL (called with "/mine").
- [ ] **Step 3: Implement**: replace all six `revalidatePath("/mine")` with `revalidatePath("/")`.
- [ ] **Step 4: Verify**: `npx vitest run src/server/actions/planned-post-actions.test.ts` PASS; `grep -rn 'revalidatePath("/mine")' src` -> no hits.
- [ ] **Step 5: Commit**: `git commit -am "fix(mine): planner writes revalidate the Dashboard"`

---

## Phase E: My reels UI

### Task E1: B-16 testids on the shipped components

**Files:** Modify `own-stat-tiles.tsx` (`Tile` root div), `reach-by-post-bars.tsx` (`ReachByPostBars` root, each `OwnPostList` row), `own-weekday-rhythm.tsx` (each bar), `graph-connect-panel.tsx` (root div, both buttons), `mine-calendar.tsx` (Undo toast action), `plan-dialog.tsx` (no-script checkbox, script select, date input, video kind select)

**Interfaces:** Produces testids `mine-stat-tile`, `mine-reach-bars`, `mine-post-row`, `mine-weekday-bar`, `mine-connect-panel`, `mine-connect-check`, `mine-connect-measure`, `mine-delete-undo`, `plan-dialog-no-script-ack`, `plan-dialog-script`, `plan-dialog-date`, `plan-dialog-video-kind`.

- [ ] **Step 1: Failing test** (new file `src/components/mine/reels-ui.test.tsx`, jsdom; E3..E6 append to it)

```tsx
/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
afterEach(cleanup);

const { OwnStatTiles } = await import("./own-stat-tiles");
const { GraphConnectPanel } = await import("./graph-connect-panel");

describe("B-16 testids", () => {
  test("six stat tiles and the connect panel with its check button", () => {
    const metric = { value: 1, sampleSize: 1, failedSampleSize: 0, wired: true };
    const overview = { account: { username: "me", followerCount: 1, followsCount: 1, mediaCount: 1, measuredAt: "2026-09-01T00:00:00.000Z" }, windowDays: 30, postsInWindow: 1, postsMeasured: 1, metrics: { reach: metric, saved: metric, shares: metric, profileVisits: metric, followsFromPost: metric, watchTimeSec: metric }, medianReach: null, medianSampleSize: 1 };
    const { container } = render(<OwnStatTiles overview={overview} />);
    expect(container.querySelectorAll('[data-testid="mine-stat-tile"]')).toHaveLength(6);
    const panel = render(<GraphConnectPanel ownHandle="@me" everMeasured initialStatus={{ configured: true, username: null, state: "auth_failed", message: null, checkedAt: "2026-09-01T00:00:00.000Z" }} />);
    expect(panel.container.querySelector('[data-testid="mine-connect-panel"]')).toBeTruthy();
    expect(panel.container.querySelector('[data-testid="mine-connect-check"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run**: `npx vitest run src/components/mine/reels-ui.test.tsx` -> FAIL.
- [ ] **Step 3: Implement**: add each `data-testid` on the element named above. For the toast, set `label: <span data-testid="mine-delete-undo">Undo</span>` in `mine-calendar.tsx`'s `toast.success(..., { action: { label, onClick } })`. For plan-dialog, put the testid on the control element itself (checkbox root, `SelectTrigger`/`NativeSelect`, date `Input`).
- [ ] **Step 4: Verify**: `npx vitest run src/components/mine` PASS; `bash scripts/testid-audit.sh` lists none of the twelve ids above.
- [ ] **Step 5: Commit**: `git add src/components/mine && git commit -m "test(mine): add the B-16 testids to shipped mine components"`

### Task E2: Wire reels reads into `MyReelsTab`

**Files:** Modify `src/components/mine/my-reels-tab.tsx`, `src/app/(shell)/(loaded)/page.tsx`

**Interfaces:**
- Consumes: `getOwnReels`, `getReelViewHistory`, `getAccountBreakdowns` (C3); `selectReel`, `shapeReelInsights`, `typicalViewsCurve` (C1, C2); `ReelPicker` (E3), `ReelInsightPanel` (E4), `AccountAudience` (E6).
- Produces: `MyReelsTab({ reel }: { reel?: string })`.

Do E3, E4, E5, E6 first (each is self-contained), then this task.

- [ ] **Step 1: Implement**. Add to the `Promise.all`: `getOwnReels()`, `getReelViewHistory()`, `getAccountBreakdowns()`. After it:

```tsx
  const selected = selectReel(reels, reel);
  const insights = selected?.latest ? shapeReelInsights(selected.latest) : null;
  // Shape on the server; only the selected reel's points cross to the client chart.
  const points = selected ? typicalViewsCurve(selected.ownPostId, history) : [];
```

Inside the not-`panelOnly` branch, after `ReachByPostBars`:

```tsx
          <section className="grid gap-8 lg:grid-cols-[minmax(260px,320px)_1fr]">
            <ReelPicker
              reels={reels.map((r) => ({ ownPostId: r.ownPostId, postedAt: r.postedAt, views: r.latest?.views ?? null, thumbnailUrl: r.thumbnailUrl, caption: r.caption }))}
              selectedId={selected?.ownPostId ?? null}
            />
            {selected && (insights ? (
              <ReelInsightPanel insights={insights} points={points} />
            ) : (
              <p className="text-sm text-muted-foreground">This reel has not been measured yet.</p>
            ))}
          </section>
          <AccountAudience data={breakdowns} />
```

In `page.tsx`: destructure `reel` and render `<MyReelsTab reel={reel} />`.

- [ ] **Step 2: Verify**: `npm run typecheck && npm run lint && npx vitest run src/components/mine` clean; dev server `/?tab=reels` renders without error on the dev db.
- [ ] **Step 3: Commit**: `git commit -am "feat(mine): My reels picker, insight panel, and audience on the tab"`

### Task E3: `ReelPicker`

**Files:** Create `src/components/mine/reel-picker.tsx`; Test `reels-ui.test.tsx`

**Interfaces:** `export interface ReelPickerItem { ownPostId: string; postedAt: string; views: number | null; thumbnailUrl: string | null; caption: string | null }`; `ReelPicker({ reels, selectedId }: { reels: ReelPickerItem[]; selectedId: string | null })`.

- [ ] **Step 1: Failing test**

```tsx
const { ReelPicker } = await import("./reel-picker");
describe("ReelPicker", () => {
  test("one link per reel setting ?reel=, the selected one marked current", () => {
    const reels = ["r3", "r2", "r1"].map((id) => ({ ownPostId: id, postedAt: "2026-09-20T00:00:00.000Z", views: 1200, thumbnailUrl: null, caption: id }));
    const { container } = render(<ReelPicker reels={reels} selectedId="r2" />);
    const items = container.querySelectorAll('[data-testid="reels-picker-item"]');
    expect(items).toHaveLength(3);
    expect(items[1].getAttribute("href")).toBe("/?tab=reels&reel=r2");
    expect(items[1].getAttribute("aria-current")).toBe("true");
    expect(items[0].getAttribute("data-id")).toBe("r3");
  });
  test("empty state says so", () => {
    const { getByText } = render(<ReelPicker reels={[]} selectedId={null} />);
    expect(getByText(/No reels measured yet/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement**

```tsx
import Link from "next/link";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { formatCompact } from "@/lib/format";

export function ReelPicker({ reels, selectedId }: { reels: ReelPickerItem[]; selectedId: string | null }) {
  if (reels.length === 0) {
    return <p className="text-sm text-muted-foreground">No reels measured yet. Every post you have is listed under Posts below.</p>;
  }
  return (
    <ItemGroup className="max-h-[520px] overflow-y-auto *:shrink-0">
      {reels.map((r) => {
        const selected = r.ownPostId === selectedId;
        return (
          <Item
            key={r.ownPostId}
            variant={selected ? "muted" : "default"}
            aria-current={selected ? "true" : undefined}
            data-testid="reels-picker-item"
            data-id={r.ownPostId}
            render={<Link href={`/?tab=reels&reel=${encodeURIComponent(r.ownPostId)}`} scroll={false} />}
          >
            <ItemMedia variant="image">
              {/* eslint-disable-next-line @next/next/no-img-element -- Instagram CDN link, not an app asset */}
              {r.thumbnailUrl ? <img src={r.thumbnailUrl} alt="" loading="lazy" /> : null}
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="block truncate">{r.caption ?? "Untitled reel"}</ItemTitle>
              <ItemDescription className="font-mono text-2xs">
                {new Date(r.postedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · <span data-num>{formatCompact(r.views)}</span> views
              </ItemDescription>
            </ItemContent>
          </Item>
        );
      })}
    </ItemGroup>
  );
}
```

(Check `src/components/ui/item.tsx` variant names; use its "selected" style variant if `muted` does not exist.)

- [ ] **Step 4: Verify** -> PASS. **Step 5: Commit**: `git add src/components/mine && git commit -m "feat(mine): reel picker"`

### Task E4: `ReelInsightPanel`

**Files:** Create `src/components/mine/reel-insight-panel.tsx`; Test `reels-ui.test.tsx`

**Interfaces:** `ReelInsightPanel({ insights, points }: { insights: ShapedReelInsights; points: ViewsPoint[] })` renders `ReelViewsOverTime` (E5) between "Actions after viewing" and the unavailable block.

- [ ] **Step 1: Failing test**

```tsx
const { ReelInsightPanel } = await import("./reel-insight-panel");
const { shapeReelInsights } = await import("@/server/services/reel-insights");
const SNAP = { capturedAt: "2026-09-29T10:00:00.000Z", views: 120000, reach: 80997, likes: 900, comments: 40, shares: 1112, saved: 300, reposts: 20, followsFromPost: 12, profileVisits: 50, bioLinkTaps: 7, avgWatchTimeMs: 4500, skipRate: 42.1, fetchError: null };
describe("ReelInsightPanel", () => {
  test("E2E-17 counts, 1.4% share rate, estimated skip rate", () => {
    const { container, getByText } = render(<ReelInsightPanel insights={shapeReelInsights(SNAP)} points={[]} />);
    const count = (id: string) => container.querySelectorAll(`[data-testid="${id}"]`).length;
    expect([count("reels-summary-tile"), count("reels-interaction"), count("reels-impact-row"), count("reels-action-row"), count("reels-unavailable"), count("reels-measured-at")]).toEqual([4, 5, 6, 3, 3, 1]);
    expect(getByText("1.4%")).toBeTruthy();
    expect(getByText("estimated")).toBeTruthy();
    expect(getByText("4.5s")).toBeTruthy();
  });
  test("E2E-23: reach 0 renders dashes, never 0%", () => {
    const { container } = render(<ReelInsightPanel insights={shapeReelInsights({ ...SNAP, reach: 0 })} points={[]} />);
    const rows = [...container.querySelectorAll('[data-testid="reels-impact-row"]')].slice(1);
    expect(rows.every((r) => r.textContent?.includes("—") && !r.textContent.includes("0%"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement**

```tsx
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCompact, formatEngagementRate, relativeTime } from "@/lib/format";
import type { InsightItem, ShapedReelInsights, ViewsPoint } from "@/server/services/reel-insights";
import { ReelViewsOverTime } from "./reel-views-over-time";

const UNAVAILABLE = ["How long people watched", "When people liked your reel", "Top sources of views"];

function itemValue(i: InsightItem): string {
  if (i.value === null) return "—";
  return i.unit === "seconds" ? `${i.value.toFixed(1)}s` : formatCompact(i.value);
}

// ponytail: reels_skip_rate is taken to be a percentage (02 section 9, unverified live).
function skipRate(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function Row({ testId, label, value, badge }: { testId: string; label: string; value: string; badge?: string }) {
  return (
    <div data-testid={testId} className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-0">
      <span className="text-sm text-muted-foreground">
        {label} {badge && <Badge variant="outline">{badge}</Badge>}
      </span>
      <span data-num className="font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

export function ReelInsightPanel({ insights, points }: { insights: ShapedReelInsights; points: ViewsPoint[] }) {
  const measured = `Measured ${relativeTime(insights.measuredAt)}`;
  return (
    <div className="flex flex-col gap-6">
      <p data-testid="reels-measured-at" className="font-mono text-2xs text-muted-foreground">
        {measured}. Instagram's numbers can lag up to 48 hours behind the app.
      </p>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        {insights.summary.map((i) => (
          <div key={i.label} data-testid="reels-summary-tile" className="flex flex-col gap-1">
            <span data-num className="font-mono text-2xl text-foreground">{itemValue(i)}</span>
            <span className="text-sm text-muted-foreground">{i.label}</span>
          </div>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>Interactions</CardTitle><CardDescription>{measured}</CardDescription></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {insights.interactions.map((i) => (
            <div key={i.label} data-testid="reels-interaction" className="flex flex-col gap-1">
              <span data-num className="font-mono text-xs text-foreground">{itemValue(i)}</span>
              <span className="font-mono text-2xs text-muted-foreground">{i.label}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>What impacts your views</CardTitle><CardDescription>Each rate is a share of the people who saw the reel. {measured}</CardDescription></CardHeader>
        <CardContent>
          {insights.impact.map((r) => (
            <Row key={r.label} testId="reels-impact-row" label={r.label} value={r.estimated ? skipRate(r.value) : formatEngagementRate(r.value)} badge={r.estimated ? "estimated" : undefined} />
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Actions after viewing</CardTitle><CardDescription>{measured}</CardDescription></CardHeader>
        <CardContent>
          {insights.actions.map((i) => <Row key={i.label} testId="reels-action-row" label={i.label} value={itemValue(i)} />)}
        </CardContent>
      </Card>
      <ReelViewsOverTime points={points} />
      <Card>
        <CardHeader><CardTitle>Not available from the Instagram API</CardTitle></CardHeader>
        <CardContent>
          {UNAVAILABLE.map((label) => (
            <Row key={label} testId="reels-unavailable" label={label} value="The Instagram API does not provide this" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Verify** -> PASS (E5 must exist; do E5 before running, or stub-free: E5's file is created in the next task, so run E4 and E5 tests together after E5). **Step 5: Commit** after E5 passes: `git add src/components/mine && git commit -m "feat(mine): reel insight panel"`

### Task E5: `ReelViewsOverTime`

**Files:** Create `src/components/mine/reel-views-over-time.tsx`; Test `reels-ui.test.tsx`

**Interfaces:** `ReelViewsOverTime({ points }: { points: ViewsPoint[] })`, client component, receives only shaped points.

- [ ] **Step 1: Failing test**

```tsx
const { ReelViewsOverTime } = await import("./reel-views-over-time");
describe("ReelViewsOverTime", () => {
  test("chart card with the typical-reel legend", () => {
    const { container, getByText } = render(<ReelViewsOverTime points={[{ hour: 1, views: 100, typical: 70 }]} />);
    expect(container.querySelector('[data-testid="reels-views-chart"]')).toBeTruthy();
    expect(getByText("Your typical reel")).toBeTruthy();
  });
  test("no points: says so instead of an empty chart", () => {
    const { getByText } = render(<ReelViewsOverTime points={[]} />);
    expect(getByText(/Not enough measurements yet/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement** (pattern: `src/components/channels/outlier-history-chart.tsx`)

```tsx
"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatCompact } from "@/lib/format";
import type { ViewsPoint } from "@/server/services/reel-insights";

const CONFIG: ChartConfig = {
  views: { label: "This reel", color: "var(--chart-1)" },
  typical: { label: "Your typical reel", color: "var(--chart-3)" },
};

/** Real measurements only, by whole hour since posting. Lines join adjacent measured hours;
 *  no point is drawn at an hour nobody measured. */
export function ReelViewsOverTime({ points }: { points: ViewsPoint[] }) {
  return (
    <Card data-testid="reels-views-chart">
      <CardHeader>
        <CardTitle>Views over time</CardTitle>
        <CardDescription>Hours since posting, against the median of your other reels at the same hour.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {points.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not enough measurements yet to draw a curve.</p>
        ) : (
          <ChartContainer config={CONFIG} className="aspect-auto h-[220px] w-full" role="img" aria-label="Line chart of this reel's views against your typical reel, by hours since posting.">
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="hour" type="number" domain={[0, "dataMax"]} tickFormatter={(h: number) => `${h}h`} />
              <YAxis width={48} tickFormatter={(v: number) => formatCompact(v)} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line dataKey="views" stroke="var(--color-views)" dot isAnimationActive={false} />
              <Line dataKey="typical" stroke="var(--color-typical)" strokeDasharray="4 4" dot isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
        )}
        <div className="flex gap-4 font-mono text-2xs text-muted-foreground">
          <span>This reel</span>
          <span>Your typical reel</span>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Verify**: `npx vitest run src/components/mine/reels-ui.test.tsx` -> PASS (E4 and E5).
- [ ] **Step 5: Commit**: `git add src/components/mine && git commit -m "feat(mine): views over time chart and reel insight panel"`

### Task E6: `AccountAudience`

**Files:** Create `src/components/mine/account-audience.tsx`; Test `reels-ui.test.tsx`

**Interfaces:** `AccountAudience({ data }: { data: AccountBreakdowns })`.

- [ ] **Step 1: Failing test**

```tsx
const { AccountAudience } = await import("./account-audience");
const DATA = { followerSplit: [{ key: "NON_FOLLOWER", value: 70 }, { key: "FOLLOWER", value: 30 }], followerSplitAt: "2026-09-28T00:00:00.000Z", audience: { age: [{ key: "25-34", value: 40 }], country: [{ key: "US", value: 50 }], gender: [{ key: "F", value: 60 }] }, audienceAt: "2026-09-28T00:00:00.000Z", audienceError: null };
describe("AccountAudience", () => {
  test("E2E-19: whole-account label on both blocks, three tabs", () => {
    const { container, getAllByText } = render(<AccountAudience data={DATA} />);
    expect(container.querySelector('[data-testid="reels-follower-split"]')).toBeTruthy();
    expect(getAllByText("Whole account, not this reel")).toHaveLength(2);
    for (const d of ["age", "country", "gender"]) expect(container.querySelector(`[data-testid="reels-audience-tab-${d}"]`)).toBeTruthy();
  });
  test("E2E-24: a refusal explains the 100-engagement threshold", () => {
    const { getByText } = render(<AccountAudience data={{ ...DATA, audienceError: "HTTP 400" }} />);
    expect(getByText(/100 or more engagements/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement**

```tsx
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatEngagementRate, relativeTime } from "@/lib/format";
import type { AccountBreakdowns, BreakdownEntry } from "@/server/queries/own-channel";

const WHOLE_ACCOUNT = "Whole account, not this reel";
const SPLIT_LABEL: Record<string, string> = { FOLLOWER: "Followers", NON_FOLLOWER: "Non-followers" };
const DIMENSIONS = [
  { id: "age", label: "Age" },
  { id: "country", label: "Country" },
  { id: "gender", label: "Gender" },
] as const;
const THRESHOLD = "Instagram shares audience details only once an account has 100 or more engagements this month, so there is nothing to show yet.";

function Shares({ entries, label = (k: string) => k }: { entries: BreakdownEntry[]; label?: (k: string) => string }) {
  const total = entries.reduce((a, b) => a + b.value, 0);
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">Not measured yet.</p>;
  return (
    <div className="flex flex-col">
      {entries.slice(0, 10).map((e) => (
        <div key={e.key} className="flex justify-between border-b border-border py-2 last:border-0">
          <span className="text-sm text-muted-foreground">{label(e.key)}</span>
          <span data-num className="font-mono text-xs">{formatEngagementRate(total > 0 ? e.value / total : null)}</span>
        </div>
      ))}
    </div>
  );
}

/** Account-level numbers the API does not give per reel, always labelled as whole-account
 *  so none reads as this reel's. Country shows the API's top results only. */
export function AccountAudience({ data }: { data: AccountBreakdowns }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card data-testid="reels-follower-split">
        <CardHeader>
          <CardTitle>Followers vs non-followers</CardTitle>
          <CardDescription>{data.followerSplitAt ? `Views, measured ${relativeTime(data.followerSplitAt)}` : "Views"}</CardDescription>
          <CardAction><Badge variant="outline">{WHOLE_ACCOUNT}</Badge></CardAction>
        </CardHeader>
        <CardContent><Shares entries={data.followerSplit} label={(k) => SPLIT_LABEL[k] ?? k} /></CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Audience details</CardTitle>
          <CardDescription>{data.audienceAt ? `Engaged audience this month, measured ${relativeTime(data.audienceAt)}` : "Engaged audience this month"}</CardDescription>
          <CardAction><Badge variant="outline">{WHOLE_ACCOUNT}</Badge></CardAction>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="age">
            <TabsList>
              {DIMENSIONS.map((d) => (
                <TabsTrigger key={d.id} value={d.id} data-testid={`reels-audience-tab-${d.id}`}>{d.label}</TabsTrigger>
              ))}
            </TabsList>
            {DIMENSIONS.map((d) => (
              <TabsContent key={d.id} value={d.id} className="pt-4">
                {data.audienceError ? <p className="text-sm text-muted-foreground">{THRESHOLD}</p> : <Shares entries={data.audience[d.id]} />}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Verify** -> PASS. **Step 5: Commit**: `git add src/components/mine && git commit -m "feat(mine): account-wide audience blocks"`

Then run Task E2.

---

## Phase F: offline e2e journeys

Seed approach: the shared seed (`scripts/seed-e2e.ts`) gains a junk Graph token in the `secrets` table, so every journey runs the "configured but rejected" state deterministically offline (a `secrets` row wins over `.env.local`). Each My reels journey first runs `npx tsx scripts/e2e/mine-seed.ts <variant>` against `CROWSNEST_DB_PATH` (exported by `run.sh`); it wipes and rewrites only the own-channel rows, so journeys stay independent while the dev server keeps running (WAL, `force-dynamic` page).

### Task F1: Seed support

**Files:** Modify `scripts/seed-e2e.ts`; Create `scripts/e2e/mine-seed.ts`

- [ ] **Step 1: `seed-e2e.ts`**: after the channel insert:

```ts
  // Junk Graph token (mine journeys): configured, but every live check fails, so My reels
  // renders stored rows under the connect panel with no network. A secrets row wins over
  // .env.local, so a real token on the machine cannot leak into the fixture run.
  for (const [name, value] of [["IG_GRAPH_TOKEN", "e2e-junk-graph-token"], ["IG_GRAPH_USER_ID", "0"]] as const) {
    await db.insert(tables.secrets).values({ name, value, updatedAt: now });
  }
```

Update the header comment's shape list with this line.

- [ ] **Step 2: `mine-seed.ts`**

```ts
/**
 * Resets the own-channel rows of the e2e fixture db to one named variant, for one
 * My reels journey (scripts/e2e/mine-e2e-1x.sh / 2x.sh). Leaves channels, videos, and
 * planned_posts alone. Usage: npx tsx scripts/e2e/mine-seed.ts <reels|reach-zero|no-reels|audience-refused>
 */
const variant = process.argv[2] ?? "reels";
process.env.CROWSNEST_DB_PATH ??= "data/e2e.db";

async function main(): Promise<void> {
  const { db, tables } = await import("../../src/server/db/index");
  const { eq } = await import("drizzle-orm");
  for (const t of [tables.ownComments, tables.ownPostInsights, tables.ownPosts, tables.ownAccountSnapshots, tables.ownAccountBreakdowns]) await db.delete(t);
  await db.delete(tables.appSettings).where(eq(tables.appSettings.key, "own_audience_fetch_error"));

  const H = 3_600_000;
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  await db.insert(tables.ownAccountSnapshots).values({ id: "snap-1", capturedAt: iso(now - H), externalId: "e2e-acct", username: "e2e_fixture_creator", followerCount: 42000, followsCount: 120, mediaCount: 4 });

  const post = (id: string, productType: string, postedMs: number) =>
    db.insert(tables.ownPosts).values({ id, externalId: `x-${id}`, permalink: `https://www.instagram.com/reel/${id}/`, mediaType: "VIDEO", productType, format: productType === "REELS" ? "Reel" : "Carousel", caption: `Fixture ${id}`, postedAt: iso(postedMs), firstSeenAt: iso(postedMs), thumbnailUrl: null });
  const snap = (ownPostId: string, postedMs: number, hour: number, v: Partial<typeof tables.ownPostInsights.$inferInsert>) =>
    db.insert(tables.ownPostInsights).values({ id: `${ownPostId}-h${hour}`, ownPostId, capturedAt: iso(postedMs + hour * H + 5 * 60_000), ...v });
  const full = { views: 120000, reach: 80997, likes: 900, comments: 40, shares: 1112, saved: 300, reposts: 20, followsFromPost: 12, profileVisits: 50, bioLinkTaps: 7, avgWatchTimeMs: 4500, skipRate: 42.1 };

  if (variant === "no-reels") {
    await post("c1", "FEED", now - 3 * 24 * H);
    await snap("c1", now - 3 * 24 * H, 1, { reach: 500 });
  } else if (variant === "reach-zero") {
    await post("rz", "REELS", now - 6 * H);
    await snap("rz", now - 6 * H, 5, { ...full, reach: 0 });
  } else {
    // reels, audience-refused: A newest (hours 1, 2, 5), B and C (hours 1, 2), one carousel.
    const A = now - 6 * H, B = now - 3 * 24 * H, C = now - 5 * 24 * H;
    await post("reelA", "REELS", A);
    await post("reelB", "REELS", B);
    await post("reelC", "REELS", C);
    await post("carousel", "FEED", now - 2 * 24 * H);
    await snap("reelA", A, 1, { ...full, views: 20000 });
    await snap("reelA", A, 2, { ...full, views: 60000 });
    await snap("reelA", A, 5, full);
    for (const [id, ms, v] of [["reelB", B, 10000], ["reelC", C, 14000]] as const) {
      await snap(id, ms, 1, { ...full, views: v });
      await snap(id, ms, 2, { ...full, views: v * 2 });
    }
    await snap("carousel", now - 2 * 24 * H, 1, { reach: 800 });
    const at = iso(now - H);
    const row = (id: string, metric: string, dimension: string, key: string, value: number) => ({ id, capturedAt: at, metric, dimension, key, value, timeframe: null });
    await db.insert(tables.ownAccountBreakdowns).values([
      row("b1", "views", "follower_type", "FOLLOWER", 30000), row("b2", "views", "follower_type", "NON_FOLLOWER", 90000),
      ...(variant === "audience-refused" ? [] : [
        row("b3", "engaged_audience_demographics", "age", "25-34", 400), row("b4", "engaged_audience_demographics", "country", "US", 500),
        row("b5", "engaged_audience_demographics", "gender", "F", 600),
      ]),
    ]);
    if (variant === "audience-refused") {
      await db.insert(tables.appSettings).values({ key: "own_audience_fetch_error", value: "HTTP 400: not enough engagement" });
    }
  }
  console.log(`mine-seed: ${variant}`);
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Verify**: `CROWSNEST_DB_PATH=data/e2e.db npx tsx scripts/seed-e2e.ts && for v in reels reach-zero no-reels audience-refused; do CROWSNEST_DB_PATH=data/e2e.db npx tsx scripts/e2e/mine-seed.ts $v; done` -> four "mine-seed:" lines, exit 0.
- [ ] **Step 4: Commit**: `git add scripts/seed-e2e.ts scripts/e2e/mine-seed.ts && git commit -m "test(mine): e2e seed variants for My reels and a junk Graph token"`

### Task F2: Tab journeys (E2E-14, 15, 26) and the moved E2E-02

**Files:** Create `scripts/e2e/mine-e2e-14.sh`, `mine-e2e-15.sh`, `mine-e2e-26.sh`; Modify `scripts/e2e/mine-e2e-02.sh`

Every script uses the `mine-e2e-02.sh` preamble:

```bash
#!/usr/bin/env bash
# mine-e2e-NN -- documents/architect/core-components/mine/04-test-cases.md, E2E-NN.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/e2e/lib.sh
```

- [ ] **Step 1: `mine-e2e-02.sh`**: arrive on `"$BASE_URL/?tab=calendar"`; update the comment ("Calendar tab"); replace `'[data-slot="checkbox"]'` with `'[data-testid="plan-dialog-no-script-ack"]'` (E1).

- [ ] **Step 2: `mine-e2e-14.sh`** (body after the preamble)

```bash
step "arrive: /"
goto_and_settle "$BASE_URL/"
step "act: My reels tab, then reload"
"$BROWSE" click '[data-testid="dashboard-tab-reels"]'
"$BROWSE" wait --networkidle
assert_url_contains "tab=reels"
goto_and_settle "$("$BROWSE" url)"
assert_url_contains "tab=reels"
step "act: Calendar tab"
"$BROWSE" click '[data-testid="dashboard-tab-calendar"]'
"$BROWSE" wait '[data-testid="mine-calendar-day"]'
assert_url_contains "tab=calendar"
step "act: Overview tab"
"$BROWSE" click '[data-testid="dashboard-tab-overview"]'
"$BROWSE" wait --networkidle
assert_url_contains "tab=overview"
if "$BROWSE" count '[data-testid="mine-calendar-day"]' | grep -qv '^0$'; then echo "calendar still rendered on Overview" >&2; exit 1; fi
snap "overview"
echo "mine-e2e-14: PASS"
```

(If `browse` has no `url` or `count` subcommand, use the equivalents `lib.sh` documents: check `lib.sh`'s `assert_url_contains` implementation for how it reads the URL, and `"$BROWSE" js 'document.querySelectorAll(...).length'` for counts.)

- [ ] **Step 3: `mine-e2e-15.sh`**

```bash
step "arrive: old /mine link with a month"
goto_and_settle "$BASE_URL/mine?month=2026-08"
assert_url_contains "tab=calendar"
assert_url_contains "month=2026-08"
"$BROWSE" wait '[data-testid="mine-calendar-day"][data-id="2026-08-15"]'
step "act: next month"
"$BROWSE" click 'a[aria-label="Next month"]'
"$BROWSE" wait --networkidle
assert_url_contains "tab=calendar"
assert_url_contains "month=2026-09"
step "act: previous month"
"$BROWSE" click 'a[aria-label="Previous month"]'
"$BROWSE" wait --networkidle
assert_url_contains "tab=calendar"
assert_url_contains "month=2026-08"
echo "mine-e2e-15: PASS"
```

- [ ] **Step 4: `mine-e2e-26.sh`**: arrive `/?tab=calendar`, record the `mine-calendar-day` count, click `dashboard-tab-calendar` twice (each followed by `wait --networkidle`), assert `tab=calendar`, assert exactly one `dashboard-tab-calendar` and the same day count.

- [ ] **Step 5: Verify**: `npm run e2e` -> mine-e2e-02, 14, 15, 26 PASS (other journeys unchanged).
- [ ] **Step 6: Commit**: `git add scripts/e2e && git commit -m "test(mine): tab and redirect journeys"`

### Task F3: My reels happy journeys (E2E-16, 17, 18, 19, 21, 25)

**Files:** Create `scripts/e2e/mine-e2e-{16,17,18,19,21,25}.sh`

Each starts with the preamble plus `npx tsx scripts/e2e/mine-seed.ts reels`.

- [ ] **Step 1: Write them**, following 04's Steps/Expected columns exactly:
  - 16: arrive `/?tab=reels`; assert 3 `reels-picker-item`; click `[data-testid="reels-picker-item"][data-id="reelB"]`; `assert_url_contains "reel=reelB"`; reload via `goto_and_settle`; still `reel=reelB`; `reels-summary-tile` present.
  - 17: click `[data-id="reelA"]`; assert counts 4/5/6/3/3 for the five testids, `assert_text "estimated"`, `assert_text "1.4%"`, `reels-measured-at` present.
  - 18: click `[data-id="reelA"]`; `reels-views-chart` present; `assert_text "Your typical reel"`.
  - 19: click each `reels-audience-tab-{age,country,gender}`; `reels-follower-split` present; `assert_text "Whole account, not this reel"` after each.
  - 21: arrive `/?tab=nonsense`: `dashboard-tab-overview` has `aria-current="page"` and 0 `reels-picker-item`; then `/?tab=reels&reel=does-not-exist`: `[data-testid="reels-picker-item"][data-id="reelA"][aria-current="true"]` present and `reels-summary-tile` present.
  - 25: arrive `/?tab=reels`; `mine-connect-panel` present above the picker; click the first `reels-picker-item`; `reels-summary-tile` and `reels-measured-at` present.

- [ ] **Step 2: Verify**: `npm run e2e` -> all six PASS; `snap` a screenshot per journey into `documents/architect/core-components/mine/test-shots/E2E-NN.png` (what `snap` writes; move if it writes elsewhere).
- [ ] **Step 3: Commit**: `git add scripts/e2e documents/architect/core-components/mine/test-shots && git commit -m "test(mine): My reels offline journeys"`

### Task F4: My reels edge journeys (E2E-22, 23, 24)

**Files:** Create `scripts/e2e/mine-e2e-{22,23,24}.sh`

- [ ] **Step 1: Write them**:
  - 22 (`mine-seed.ts no-reels`): arrive `/?tab=reels`; 0 `reels-picker-item`, 0 `reels-summary-tile`; `assert_text "No reels measured yet"`; at least one `mine-post-row` (no Posts tab click: the post list is a section of My reels).
  - 23 (`reach-zero`): click the reel; every `reels-impact-row` after the first contains "—" and none contains "0%" (read via `"$BROWSE" js`).
  - 24 (`audience-refused`): click `reels-audience-tab-age`; `assert_text "100 or more engagements"`.
- [ ] **Step 2: Verify**: `npm run e2e` -> PASS. Then `npx tsx scripts/e2e/mine-seed.ts reels` is not needed afterwards (each journey seeds its own variant).
- [ ] **Step 3: Commit**: `git add scripts/e2e && git commit -m "test(mine): My reels edge-case journeys"`

### Task F5: SEC-03 check and the full offline run

- [ ] **Step 1**: with `npm run e2e`'s server up (or `CROWSNEST_DB_PATH=data/e2e.db PORT=3001 npm run dev`), run:

```bash
for t in overview reels calendar; do curl -s "http://localhost:3001/?tab=$t" | grep -c "e2e-junk-graph-token"; done
```

Expected: `0` three times. Record SEC-03 🟢 in G1.
- [ ] **Step 2**: `npm run e2e` end to end; record every journey's result for G1.

---

## Phase G: docs and final gate

### Task G1: Docs owned by the build

**Files:** `documents/architect/core-components/mine/01-concept-brief.md`, `02-architecture.md`, `03-feature-description.md`, `04-test-cases.md`, `05-backlog-to-enhance.md`, `documents/architect/shared/navigation-and-shell.md`, `documents/architect/shared/persistence.md`, `documents/architect/core-components/publish/02-architecture.md`

- [ ] **Step 1: mine 01**: status line and section 1 state the rework as shipped; the "Today, before the rework ships" paragraph is removed.
- [ ] **Step 2: mine 02**: fold 1.2 rows into 1.1 as shipped; `MinePage` row reads "redirect"; `graph-actions.ts` row: wrapper over `own-measure.ts`; client row: `fetchMedia`, `fetchPostInsights`, `fetchAccountBreakdowns`, and `fetchPosts` removed (the service composes the two calls); ER diagram drops "planned" markers; 2.1 names the actual migration file; section 4 notes lines join adjacent measured hours with no synthetic points, comments are skipped when the budget cannot cover them, and non-reel posts follow the same due rule; section 6/7 titles drop "(planned)"; section 9 keeps every open item still unverified live (metric availability, units, bio link action name, views split window, thumbnail lifetime, budget with a same-hour manual run) and adds "breakdown refusals retry each tick".
- [ ] **Step 3: mine 03**: features 9, 10, 11, 12, 13, 14 marked ● (12 and 14 note "live cadence unverified, needs a valid Graph token"); feature 4 and E2E steps no longer mention the Posts and Metrics tab strip (sections of My reels); feature 7 notes "Measure now" waits for a running scheduled measurement.
- [ ] **Step 4: mine 04**: Result column for every row run in this plan (vitest ids from Phases A to E, E2E from F, SEC-03 to SEC-07); ACTION-15 claim updated (`profileVisits`, `followsFromPost` wired; `watchTimeSec` not); E2E-05, 07, 11, 22 steps drop the `mine-tab-posts`/`mine-tab-metrics` clicks; every "[not present yet]" for an id added in E1 removed; `scripts/e2e/mine-e2e-NN.sh (planned)` becomes the path; the E2E-02 note about `/mine` removed; live rows E2E-04, 06, 12, 20 and MINE-36 read "🟡 blocked: needs a valid Graph token".
- [ ] **Step 5: mine 05**: B-16 status `done`; B-15 and B-17 unchanged.
- [ ] **Step 6: shared docs**: `navigation-and-shell.md` (sidebar has no "My channel"; Dashboard carries the three tabs in `?tab=`; `/mine` redirects), `persistence.md` (`own_account_breakdowns`, the new columns, `own_audience_fetch_error`), `publish/02-architecture.md` (the `MinePage (extended)` row becomes `CalendarTab` in `src/components/mine/calendar-tab.tsx`).
- [ ] **Step 7: Verify**: `grep -rnP "\x{2013}|\x{2014}" documents/architect/core-components/mine documents/architect/shared/navigation-and-shell.md documents/architect/shared/persistence.md` -> no hits; `bash scripts/testid-audit.sh` lists no `mine-*`, `reels-*`, `dashboard-tab-*`, or `plan-dialog-*` id.
- [ ] **Step 8: Commit**: `git add documents && git commit -m "docs(mine): record the shipped Dashboard rework"`

### Task G2: Final gate

- [ ] **Step 1**: `npm run build && npm run test && npm run lint && npm run typecheck` -> all pass.
- [ ] **Step 2**: `bash scripts/testid-audit.sh && bash scripts/skill-lint.sh` -> clean for mine ids.
- [ ] **Step 3**: `node .gitnexus/run.cjs detect-changes --scope compare --base-ref main --repo .` -> changed symbols are only those in the file map; `partial` and `truncated` both false (re-run if not).
- [ ] **Step 4**: `git status` clean. Hand the reviewer: this plan, `git log main..HEAD --oneline`, the G1 04 results, and the detect-changes output.

---

## Risks

| Risk | Handling |
| --- | --- |
| New metric names, units, `metric_type=total_value` on media insights, and the bio link action name are unverified against a live call (token rejected) | Extended set falls back once to the pre-rework core set; a wrong bio link name yields null. Live rows stay 🟡. 02 section 9 keeps these open. |
| `fetchPostInsights` now throws on a per-post rate limit or auth failure (was folded into `insights.error`) | Intentional: the run stops cleanly and already-written rows stay (ACTION-30). Only caller is the service. |
| Manual "Measure now" plus the hourly tick in the same hour can exceed 200 calls | Per-run budget 150; the rate-limit stop is the only cross-run guard (documented open item). |
| `crowsnest_metrics` MCP output: `profileVisits`/`followsFromPost` flip to `wired: true` | Honest now that they are requested; no schema change. |
| The scheduler's first tick fires one interval after boot | Due-ness is derived from stored captures, so nothing is lost across restarts. |
| Line segments in the views chart join adjacent measured hours | No synthetic points are plotted; noted in 02. |
| Breakdown refusals retry every tick (4 calls an hour) | `ponytail:` comment in `own-measure.ts`; add a refusal timestamp if the budget ever gets tight. |
| B-17 (`/mine/<id>` dead published link) and B-15 (no "clear own channel") | Out of scope, rows stay open. |
| Settings `graph-section.tsx` copy still says "My channel" | Copy follow-up, not in this plan. |
| E2E-13 needs no Graph token while `.env.local` may hold one | Not in scope (feature 8); stays "not run". |
| `/mine` topbar title removed; the route now only redirects | Covered by D4. |
