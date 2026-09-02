# M3b dashboard implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the dashboard shipping the whole library to the client, make the two undecodable charts readable, and add a what-changed strip.

**Architecture:** Three tasks over the dashboard page and its chart-shaping module. Only the score ranking list is a client boundary that receives the full FeedItem array, so the payload fix is a targeted slim of that one prop plus a real-range bar scale. The producer donut groups producers past the top few into "Other" so its four-color palette never repeats. A what-changed strip reads a persisted last-visit timestamp and counts outliers first seen since then. The chart-data module and the page are touched by more than one task, so this is one sequential workstream, not parallel.

**Tech stack:** Next.js 16 (server components, one "use client" island), TypeScript, drizzle-orm with better-sqlite3, vitest.

## Global constraints

- No new lint or type problem over baseline. tsc clean, lint 0 errors, tests green.
- npm and node are not on the default PATH from the shell. Export `PATH="/opt/homebrew/bin:$PATH"` first. Run tests with `node_modules/.bin/vitest`.
- The producer donut's neutral four-color palette is a deliberate choice (amber is reserved for the score). This plan keeps it and groups the tail into "Other" rather than adding a rainbow palette.
- The shared score scale `scalePosition` (median-baseline.tsx) is not changed. The ranking bars get their own set-relative scale, local to that list.
- No schema change: the last-visit timestamp uses the existing app_settings key-value table, the same pattern as recently_viewed in queries/video.ts.
- Commit with an explicit pathspec (`git commit -- <paths>`), not `git add` then commit, so nothing else in the index can ride along.
- Prose in docs follows the humanizer rules. Code and identifiers are left as they are.
- Start each task from a clean tree, commit at the end of each.

---

### Task 1: Slim the ranking list payload and scale its bars to the set

The score ranking list is `"use client"` and receives the full FeedItem array (up to 10,000 objects) to render, which is the dashboard's per-navigation payload. Compute a slim projection server-side and pass that. While there, fix the bars: they use the shared 0.2x to 12x `scalePosition`, so 13x and 116x both hit ~100% and look identical. Scale each bar to the highest score in the set instead.

**Files:**
- Modify: `src/components/dashboard/dashboard-chart-data.ts`
- Modify: `src/components/dashboard/score-ranking-list.tsx`
- Modify: `src/app/(shell)/page.tsx`
- Test: `src/components/dashboard/dashboard-chart-data.test.ts`

**Interfaces:**
- Produces: `RankingRow` and `rankingRows(items: FeedItem[]): { rows: RankingRow[]; unranked: number }`.
- Consumes (page): passes `rows` and `unranked` to `ScoreRankingList`.

- [ ] **Step 1: Write the failing test**

Add to `src/components/dashboard/dashboard-chart-data.test.ts` (reuse its existing FeedItem factory):

```ts
import { rankingRows } from "./dashboard-chart-data";

describe("rankingRows", () => {
  test("projects only the fields the list renders, drops unscored, counts them", () => {
    const items = [
      makeItem({ videoId: "a", outlierScore: 5, caption: "hi", handle: "@x", platform: "instagram" }),
      makeItem({ videoId: "b", outlierScore: null }),
    ];
    const { rows, unranked } = rankingRows(items);
    expect(unranked).toBe(1);
    expect(rows).toEqual([{ videoId: "a", score: 5, caption: "hi", handle: "@x", platform: "instagram", deleted: false }]);
  });
});
```

Adapt `makeItem` to the factory this test file already uses (it builds FeedItem objects for the other chart tests). The `handle`/`platform` in the expectation come from `item.channel`.

- [ ] **Step 2: Run the test, verify it fails**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node_modules/.bin/vitest run src/components/dashboard/dashboard-chart-data.test.ts -t "rankingRows"
```
Expected: FAIL, `rankingRows` is not exported.

- [ ] **Step 3: Add the slim projection**

In `src/components/dashboard/dashboard-chart-data.ts`, add near the ranking section (after `rankableItems`):

```ts
export interface RankingRow {
  videoId: string;
  score: number;
  caption: string | null;
  handle: string;
  platform: string;
  deleted: boolean;
}

/**
 * The slim shape the score ranking list actually renders. The list is a client
 * component, so passing full FeedItems serialized the whole library into the RSC payload
 * on every dashboard visit. This projects the six fields the row uses, computed
 * server-side, so only those cross the wire.
 */
export function rankingRows(items: FeedItem[]): { rows: RankingRow[]; unranked: number } {
  const rows: RankingRow[] = [];
  for (const item of items) {
    if (item.outlierScore === null) continue;
    rows.push({
      videoId: item.videoId,
      score: item.outlierScore,
      caption: item.caption,
      handle: item.channel.handle,
      platform: item.channel.platform,
      deleted: item.deleted,
    });
  }
  return { rows, unranked: items.length - rows.length };
}
```

- [ ] **Step 4: Rewrite the component to take the slim rows and rescale**

Replace `src/components/dashboard/score-ranking-list.tsx`. Keep `"use client"` (the show-all toggle needs state). Change the props to `{ rows, unranked }`, drop the `rankableItems` and `scalePosition` imports and the FeedItem import, and scale each bar to the top score in the set:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";

import { platformLabel } from "@/components/feed/platform-chip";
import { formatMultiplier } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RankingRow } from "./dashboard-chart-data";

const COLLAPSED_LIMIT = 8;

export function ScoreRankingList({ rows, unranked }: { rows: RankingRow[]; unranked: number }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, COLLAPSED_LIMIT);
  // Rows arrive highest-first, so the first is the set max. Bars scale to it, so 116x and
  // 13x no longer both read as a full bar. A single min floor keeps a real score visible.
  const maxScore = rows[0]?.score ?? 1;

  if (rows.length === 0) {
    return (
      <div>
        <span data-lab className="font-mono text-2xs text-faint">
          Ranking
        </span>
        <p className="mt-6 max-w-[52ch] text-sm text-muted-foreground">
          Nothing has a score yet — a channel needs enough posts before one means anything.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-6">
        <span data-lab className="font-mono text-2xs text-faint">
          Ranking · <span data-num>{rows.length}</span> scored
          {unranked > 0 ? <span> · {unranked} not scored yet</span> : null}
        </span>
        {rows.length > COLLAPSED_LIMIT && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="shrink-0 font-mono text-2xs text-muted-foreground hover:text-foreground"
          >
            {showAll ? "Show top 8" : `Show all ${rows.length}`}
          </button>
        )}
      </div>
      <div className="mt-6 flex flex-col gap-1.5">
        {visible.map((row) => {
          const beat = row.score >= 1;
          const widthPct = Math.max(1.5, (row.score / maxScore) * 100);
          return (
            <Link
              key={row.videoId}
              href={`/feed/${row.videoId}`}
              className="grid min-h-[46px] grid-cols-[64px_96px_minmax(0,1fr)_auto] items-center gap-4 border-b border-border hover:bg-card"
            >
              <span data-num className={cn("text-right font-mono text-sm", beat ? "text-score" : "text-muted-foreground")}>
                {formatMultiplier(row.score)}
              </span>
              <span className="relative h-1.5" aria-hidden>
                <span
                  className={cn("absolute top-0 left-0 h-1.5", beat ? "bg-score" : "bg-line-strong")}
                  style={{ width: `${widthPct}%` }}
                />
              </span>
              <span className={cn("truncate text-sm", beat ? "text-foreground" : "text-muted-foreground")}>
                {row.caption ?? "—"}
                {row.deleted && (
                  <span className="ml-2 text-2xs text-destructive">no longer on {platformLabel(row.platform)}</span>
                )}
              </span>
              <span className="shrink-0 truncate text-right font-mono text-xs text-faint">{row.handle}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire the page to pass the slim rows**

In `src/app/(shell)/page.tsx`, import `rankingRows` from the chart-data module, and replace `<ScoreRankingList items={allItems} />` (line 197) with a server-side computation:

```tsx
          <ScoreRankingList {...rankingRows(allItems)} />
```

`rankingRows` returns `{ rows, unranked }`, which spreads onto the component's props.

- [ ] **Step 6: Typecheck, lint, test**

```bash
export PATH="/opt/homebrew/bin:$PATH"
npm run typecheck
npm run lint
node_modules/.bin/vitest run src/components/dashboard/dashboard-chart-data.test.ts
```
Expected: tsc clean, lint 0, rankingRows test passes. The visual bar change is verified in the browser QA pass.

- [ ] **Step 7: Commit**

```bash
git commit -- src/components/dashboard/dashboard-chart-data.ts src/components/dashboard/score-ranking-list.tsx "src/app/(shell)/page.tsx" src/components/dashboard/dashboard-chart-data.test.ts -m "perf(dashboard): slim the ranking list payload and scale its bars to the set"
```

---

### Task 2: Group producers past the top few into "Other"

The producer donut has four neutral colors and reuses them once there are more than four producers, so three producers can share a swatch and the chart cannot be read. Keep the palette and fold the tail into a single "Other" slice, so at most four slices draw and no color repeats.

**Files:**
- Modify: `src/components/dashboard/dashboard-chart-data.ts`
- Modify: `src/components/dashboard/producer-donut.tsx`
- Test: `src/components/dashboard/dashboard-chart-data.test.ts`

**Interfaces:**
- Produces: `PRODUCER_DONUT_MAX_SLICES`, and `buildProducerDonut` now returns at most that many slices, the last being an "Other" slice with `channelId: ""` when the tail was folded.
- Consumes (component): renders an "Other" slice as plain text, not a channel link.

- [ ] **Step 1: Write the failing test**

Add to `src/components/dashboard/dashboard-chart-data.test.ts`:

```ts
import { buildProducerDonut, PRODUCER_DONUT_MAX_SLICES } from "./dashboard-chart-data";

test("folds producers past the max into a single Other slice", () => {
  // six channels each with one beating post
  const items = ["a", "b", "c", "d", "e", "f"].map((h, i) =>
    makeItem({ videoId: `v${i}`, outlierScore: 2, channelId: `c${i}`, handle: `@${h}` })
  );
  const donut = buildProducerDonut(items);
  expect(donut.slices.length).toBe(PRODUCER_DONUT_MAX_SLICES);
  const other = donut.slices[donut.slices.length - 1];
  expect(other.handle).toBe("Other");
  expect(other.channelId).toBe("");
  // Other holds the folded tail; every slice's count still sums to the outlier total.
  expect(donut.slices.reduce((s, x) => s + x.count, 0)).toBe(donut.outlierTotal);
});
```

Confirm `makeItem` accepts a `channelId` and `handle` (the test file's factory sets `item.channel.id` / `item.channel.handle`); adapt the field names to it.

- [ ] **Step 2: Run the test, verify it fails**

```bash
node_modules/.bin/vitest run src/components/dashboard/dashboard-chart-data.test.ts -t "Other slice"
```
Expected: FAIL, `PRODUCER_DONUT_MAX_SLICES` is not exported and six slices come back.

- [ ] **Step 3: Fold the tail in buildProducerDonut**

In `src/components/dashboard/dashboard-chart-data.ts`, add the constant near the donut section and fold after the sort inside `buildProducerDonut`:

```ts
/** The donut's palette is four neutral surfaces (producer-donut.tsx), so at most four
 *  slices can draw without a color repeating. Producers past the top few fold into one
 *  "Other" slice rather than reusing a swatch. */
export const PRODUCER_DONUT_MAX_SLICES = 4;
```

Replace the `const slices = ...sort(...)` and the return in `buildProducerDonut` with:

```ts
  const sorted = [...tally.entries()]
    .map(([channelId, row]) => ({
      channelId,
      handle: row.handle,
      count: row.count,
      pct: outlierTotal > 0 ? Math.round((row.count / outlierTotal) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  let slices = sorted;
  if (sorted.length > PRODUCER_DONUT_MAX_SLICES) {
    const head = sorted.slice(0, PRODUCER_DONUT_MAX_SLICES - 1);
    const tail = sorted.slice(PRODUCER_DONUT_MAX_SLICES - 1);
    const count = tail.reduce((sum, r) => sum + r.count, 0);
    head.push({ channelId: "", handle: "Other", count, pct: outlierTotal > 0 ? Math.round((count / outlierTotal) * 100) : 0 });
    slices = head;
  }

  return { slices, outlierTotal, postTotal: items.length };
```

- [ ] **Step 4: Render the Other slice as plain text, not a link**

In `src/components/dashboard/producer-donut.tsx`, the legend maps arcs to `<Link href={/channels/${arc.channelId}}>`. An "Other" slice has `channelId: ""`, which is not a channel. Guard it:

```tsx
          {arcs.map((arc) =>
            arc.channelId ? (
              <Link key={arc.channelId} href={`/channels/${arc.channelId}`} className="flex items-center gap-3 hover:underline">
                <span aria-hidden className="size-2 shrink-0" style={{ background: arc.color }} />
                <span className="min-w-[160px] text-sm text-foreground">{arc.handle}</span>
                <span data-num className="font-mono text-sm text-muted-foreground">{arc.count}</span>
              </Link>
            ) : (
              <div key="other" className="flex items-center gap-3">
                <span aria-hidden className="size-2 shrink-0" style={{ background: arc.color }} />
                <span className="min-w-[160px] text-sm text-muted-foreground">{arc.handle}</span>
                <span data-num className="font-mono text-sm text-muted-foreground">{arc.count}</span>
              </div>
            )
          )}
```

The `key` on the Other branch is the literal "other" since its channelId is empty. Confirm the `top` handle in the caption still reads sensibly (the top slice is a real producer, never Other, because Other is appended last and sorted input puts the largest first).

- [ ] **Step 5: Typecheck, lint, test**

```bash
npm run typecheck
npm run lint
node_modules/.bin/vitest run src/components/dashboard/dashboard-chart-data.test.ts
```
Expected: clean, and both the new fold test and the existing donut tests pass.

- [ ] **Step 6: Commit**

```bash
git commit -- src/components/dashboard/dashboard-chart-data.ts src/components/dashboard/producer-donut.tsx src/components/dashboard/dashboard-chart-data.test.ts -m "fix(dashboard): fold producers past the top few into an Other donut slice"
```

---

### Task 3: What-changed strip

Add a strip at the top of the dashboard that says how many outliers were first seen since the last visit. It reads a persisted last-visit timestamp from app_settings, counts outliers whose firstSeenAt is after it, then bumps the timestamp to now. Biggest-movers is not built: there is no score history to diff against, so only the honest new-since-visit count ships.

**Files:**
- Modify: `src/server/queries/dashboard.ts`
- Modify: `src/app/(shell)/page.tsx`
- Test: `src/server/queries/dashboard.test.ts` (confirm the file name; create if absent)

**Interfaces:**
- Produces: `getNewOutliersSince(sinceIso: string | null): Promise<number>`, `readAndBumpDashboardLastVisit(now?: string): Promise<string | null>`.
- Consumes: the existing `OUTLIER_MIN_SCORE`, `db`, `tables`, and `nowIso` from `@/server/db`.

- [ ] **Step 1: Write the failing test**

Add to the dashboard query test (reuse its seed helpers):

```ts
import { getNewOutliersSince, readAndBumpDashboardLastVisit } from "./dashboard";

test("counts outliers first seen after the cutoff, skips older and unscored", async () => {
  const cutoff = new Date("2026-08-01T00:00:00.000Z").toISOString();
  await seedVideoRow({ outlierScore: 3, firstSeenAt: "2026-08-02T00:00:00.000Z" }); // counted
  await seedVideoRow({ outlierScore: 3, firstSeenAt: "2026-07-01T00:00:00.000Z" }); // too old
  await seedVideoRow({ outlierScore: 1, firstSeenAt: "2026-08-02T00:00:00.000Z" }); // below OUTLIER_MIN_SCORE

  expect(await getNewOutliersSince(cutoff)).toBe(1);
  expect(await getNewOutliersSince(null)).toBe(0);
});

test("readAndBumpDashboardLastVisit returns the previous value and writes now", async () => {
  const first = await readAndBumpDashboardLastVisit("2026-08-05T00:00:00.000Z");
  expect(first).toBeNull(); // nothing stored yet
  const second = await readAndBumpDashboardLastVisit("2026-08-06T00:00:00.000Z");
  expect(second).toBe("2026-08-05T00:00:00.000Z");
});
```

Adapt `seedVideoRow` to the test file's real seeding (it needs a channel row too; reuse the file's existing helper). Confirm `videos.firstSeenAt` is the column name (it is used in the frame-pass and feed seed helpers).

- [ ] **Step 2: Run the test, verify it fails**

```bash
node_modules/.bin/vitest run src/server/queries/dashboard.test.ts -t "cutoff|readAndBump"
```
Expected: FAIL, the two functions are not exported.

- [ ] **Step 3: Implement the query and the last-visit store**

In `src/server/queries/dashboard.ts`, add `nowIso` to the db import, and add:

```ts
const DASHBOARD_LAST_VISIT_KEY = "dashboard_last_visit";

/** How many outliers (score >= OUTLIER_MIN_SCORE, not removed) were first seen after
 *  `sinceIso`. Null cutoff means the first ever visit, so nothing is "new" yet. */
export async function getNewOutliersSince(sinceIso: string | null): Promise<number> {
  if (!sinceIso) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(tables.videos)
    .where(
      and(
        gte(tables.videos.outlierScore, OUTLIER_MIN_SCORE),
        gte(tables.videos.firstSeenAt, sinceIso),
        isNull(tables.videos.deletedAt)
      )
    );
  return row?.count ?? 0;
}

/** Reads the stored last-visit timestamp (or null the first time), then writes `now`.
 *  Runs on every dashboard load, so "since last visit" means since the previous load. */
export async function readAndBumpDashboardLastVisit(now: string = nowIso()): Promise<string | null> {
  const [row] = await db.select().from(tables.appSettings).where(eq(tables.appSettings.key, DASHBOARD_LAST_VISIT_KEY)).limit(1);
  const prev = row?.value ?? null;
  if (row) await db.update(tables.appSettings).set({ value: now }).where(eq(tables.appSettings.key, DASHBOARD_LAST_VISIT_KEY));
  else await db.insert(tables.appSettings).values({ key: DASHBOARD_LAST_VISIT_KEY, value: now });
  return prev;
}
```

- [ ] **Step 4: Run the tests, verify they pass**

```bash
node_modules/.bin/vitest run src/server/queries/dashboard.test.ts
```
Expected: PASS.

- [ ] **Step 5: Render the strip on the page**

In `src/app/(shell)/page.tsx`, add the two reads to the initial `Promise.all` or right after it (they must run before the KPI section). Because `readAndBumpDashboardLastVisit` writes, call it once and pass its result to `getNewOutliersSince`:

```tsx
  const lastVisit = await readAndBumpDashboardLastVisit();
  const newSinceVisit = await getNewOutliersSince(lastVisit);
```

Import both from `@/server/queries/dashboard`. Then, inside the main return, right after the KPI grid (`</div>` closing the grid at line 141), add:

```tsx
      {newSinceVisit > 0 && (
        <Link href="/feed" className="flex items-center gap-2 text-sm text-foreground hover:underline">
          <span className="font-mono text-score" data-num>{newSinceVisit}</span>
          new outlier{newSinceVisit === 1 ? "" : "s"} since your last visit
        </Link>
      )}
```

`Link` is already imported at the top of the file.

- [ ] **Step 6: Typecheck, lint, full suite**

```bash
npm run typecheck
npm run lint
npm test 2>&1 | tail -3
```
Expected: clean, all tests pass.

- [ ] **Step 7: Commit**

```bash
git commit -- src/server/queries/dashboard.ts src/server/queries/dashboard.test.ts "src/app/(shell)/page.tsx" -m "feat(dashboard): a what-changed strip counting outliers first seen since the last visit"
```

---

## Final verification

- [ ] `npm run lint` 0 errors, `npm run typecheck` clean, `npm test` green.
- [ ] Browser QA (deferred): the ranking bars show different lengths for the top scores; the donut shows at most four slices with an Other row and no repeated color; the what-changed strip shows a count after new outliers are synced.

## Self-review notes

- Spec coverage: M3-U4 (Task 1 slims the one client boundary that shipped the library), M3-U6 (Task 1 rescales the ranking bars, Task 2 fixes the donut), M3-U7 (Task 3). The dashboard slice (U4) is smaller than the review implied because only the ranking list was a client boundary; the other charts already render server-side.
- Design decisions respected: the donut keeps its neutral palette (tail folded into Other, no rainbow), and the shared `scalePosition` is untouched (the ranking bars get a local set-relative scale).
- U7 ships the new-since-visit count only. Biggest-movers is dropped because there is no score history to diff, which is stated in the task rather than faked.
- Execution is one sequential workstream: dashboard-chart-data.ts is touched by Tasks 1 and 2, and page.tsx by Tasks 1 and 3, so a single agent runs the three tasks in order. Commit with `git commit -- <paths>` so a shared index cannot combine commits (the M3a lesson).
- Confirm during each task: the real factory/seed helper names in dashboard-chart-data.test.ts and dashboard.test.ts, and that videos.firstSeenAt is the column name (used by existing seed helpers).
