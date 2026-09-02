# M3a feed sort and default view implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the feed's outlier-score query use an index (241x faster on a large library), and open a bare /feed on the High Conviction view with a one-tap show-all escape.

**Architecture:** Two tasks. Task 1 adds an index on videos.outlier_score and drops the redundant `IS NULL` sort key so the index is usable (SQLite already sorts NULLs last under DESC, so row order is unchanged). Task 2 auto-applies the seeded High Conviction saved filter when the feed URL carries no filter params, with `?all=1` as the explicit escape. This is the feed half of milestone 3, split from the dashboard half (M3b) and from the feed UI half (toolbar grouping and list virtualization, M3a part 2) so each ships on its own.

**Tech stack:** Next.js 16 (server components, URL search params as state), TypeScript, drizzle-orm with better-sqlite3, vitest.

## Global constraints

- No new lint or type problem over baseline. tsc clean (`npm run typecheck`), tests green (`npm test`), lint 0 errors (`npm run lint`).
- npm and node are not on the default PATH from the shell. Export `PATH="/opt/homebrew/bin:$PATH"` first. Run tests with `node_modules/.bin/vitest`.
- Dev DB is push and bootstrap based. A new migration is produced with `npm run db:generate`, applied by hand with `sqlite3 data/crowsnest.db < drizzle/NNNN.sql` on a backup-first basis, and recorded in `__drizzle_migrations` (sha256 of the file, created_at = the journal `when`), the same as M1. Tests replay ./drizzle in memory, so the generated file is enough for them.
- The two seeded system saved filters are Balanced `{ minScore: 5, sinceDays: 30 }` and High Conviction `{ minScore: 10, sinceDays: 14, minViews: 500_000 }` (src/server/db/bootstrap.ts). High Conviction is the default view this plan applies.
- Prose in docs follows the humanizer rules. Code and identifiers are left as they are.
- Start each task from a clean tree, commit at the end of each.

---

### Task 1: Index outlier_score and drop the redundant null sort key

The feed's score sort is `ORDER BY outlier_score IS NULL, outlier_score DESC`. The leading `IS NULL` expression makes any index on outlier_score unusable, and there is no index on the column anyway, so the most-run query is a full scan plus a temp b-tree. SQLite already orders NULLs last under DESC, so the `IS NULL` key changes nothing about row order. Drop it and add the index.

**Files:**
- Modify: `src/server/db/schema.ts` (the videos table index list, around line 130)
- Create: `drizzle/00NN_*.sql` (generated)
- Modify: `src/server/queries/feed.ts:199-211` (buildOrderBy)
- Test: `src/server/queries/feed.test.ts`

**Interfaces:**
- Consumes: existing `getOutlierFeed`, `buildOrderBy`.
- Produces: an index `videos_outlier_score`. No API change.

- [ ] **Step 1: Write the failing test (order is preserved, index is used)**

Add to `src/server/queries/feed.test.ts` (reuse the file's existing seed helpers and in-memory db):

```ts
import { sql } from "drizzle-orm";

test("score sort puts real scores desc then nulls last, and uses the outlier_score index", async () => {
  // seed three videos: score 5, score 1, score null (reuse this file's seedVideo helper shape)
  await seedScored([5, 1, null]); // confirm/adapt to the file's existing seeding pattern

  const { items } = await getOutlierFeed({ sort: "score", limit: 200, offset: 0 });
  expect(items.map((i) => i.outlierScore)).toEqual([5, 1, null]);

  const plan = db.all(sql`EXPLAIN QUERY PLAN
    SELECT id FROM videos ORDER BY outlier_score DESC LIMIT 24`) as { detail: string }[];
  const usesIndex = plan.some((r) => /USING INDEX videos_outlier_score/.test(r.detail));
  expect(usesIndex).toBe(true);
});
```

Note: adapt `seedScored` to this test file's real seeding helper (it already inserts channel plus video rows for its other ordering tests, for example the "null outlier scores" test at line 201). The EXPLAIN QUERY PLAN uses raw SQL against the same in-memory db so it reads the real plan.

- [ ] **Step 2: Run the test, verify it fails**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node_modules/.bin/vitest run src/server/queries/feed.test.ts -t "uses the outlier_score index"
```
Expected: FAIL, no index named videos_outlier_score exists yet.

- [ ] **Step 3: Add the index to the schema**

In `src/server/db/schema.ts`, in the videos table's index array (currently lines 130-131, which has `videos_platform_external` and `videos_channel_posted`), add:

```ts
  index("videos_outlier_score").on(t.outlierScore),
```

- [ ] **Step 4: Generate and apply the migration**

```bash
export PATH="/opt/homebrew/bin:$PATH"
npm run db:generate
# note the new file name, e.g. drizzle/0014_*.sql, confirm it only creates the index
sqlite3 data/crowsnest.db ".backup data/crowsnest.db.bak-pre-outlier-index"
sqlite3 data/crowsnest.db < drizzle/0014_*.sql
# record it so db:migrate stays clean (compute the hash and journal when):
node -e 'const fs=require("fs"),c=require("crypto");const f=process.argv[1];const h=c.createHash("sha256").update(fs.readFileSync(f,"utf8")).digest("hex");const j=require("./drizzle/meta/_journal.json");const tag=f.split("/").pop().replace(".sql","");const when=j.entries.find(e=>e.tag===tag).when;console.log(h,when)' drizzle/0014_*.sql
# then insert that hash + when:
sqlite3 data/crowsnest.db "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('<hash>', <when>);"
npm run db:migrate   # expect: up to date, no-op
```

- [ ] **Step 5: Drop the null key in buildOrderBy**

In `src/server/queries/feed.ts`, change the `score` case of `buildOrderBy` (lines 201-204) to:

```ts
    case "score":
      // SQLite sorts NULLs last under DESC, so this alone matches the old
      // "IS NULL, DESC" order and lets the videos_outlier_score index do the sort.
      return [desc(tables.videos.outlierScore)];
```

- [ ] **Step 6: Run the tests, verify they pass**

```bash
node_modules/.bin/vitest run src/server/queries/feed.test.ts
```
Expected: PASS, including the existing "null outlier scores ... sorted last under sort=score" test at line 201, which proves the order did not change.

- [ ] **Step 7: Commit**

```bash
git add src/server/db/schema.ts drizzle/ src/server/queries/feed.ts src/server/queries/feed.test.ts
git commit -m "perf(feed): index outlier_score and drop the null sort key so the query uses it"
```

---

### Task 2: Open a bare feed on the High Conviction view

Today a bare /feed shows the whole unfiltered library (sorted by score). Apply the seeded High Conviction filter when the URL carries no filter param, and give `?all=1` as the explicit escape so a user can still see everything. The filter params already in the URL are respected as before.

**Files:**
- Modify: `src/lib/feed-filters.ts` (add a pure gate)
- Modify: `src/app/(shell)/feed/page.tsx`
- Test: `src/lib/feed-filters.test.ts` (create if absent, or add to the existing feed-filters test)

**Interfaces:**
- Produces: `shouldApplyDefaultView(sp: SearchParams): boolean`.
- Consumes: existing `isFeedEmpty`, `first`, the `getSavedFilters` result already loaded on the page (it carries the High Conviction row and its criteria).

- [ ] **Step 1: Write the failing test**

Add to the feed-filters test (confirm the file name, `src/lib/feed-filters.test.ts`; create it if none exists, matching the repo's vitest import style):

```ts
import { describe, expect, test } from "vitest";
import { shouldApplyDefaultView } from "./feed-filters";

describe("shouldApplyDefaultView", () => {
  test("applies the default on a bare visit", () => {
    expect(shouldApplyDefaultView({})).toBe(true);
  });
  test("does not apply when a filter param is present", () => {
    expect(shouldApplyDefaultView({ minScore: "3" })).toBe(false);
  });
  test("does not apply when the show-all escape is set", () => {
    expect(shouldApplyDefaultView({ all: "1" })).toBe(false);
  });
  test("a cosmetic-only param (sort, density) still counts as bare", () => {
    expect(shouldApplyDefaultView({ sort: "recent", density: "compact" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
node_modules/.bin/vitest run src/lib/feed-filters.test.ts -t "shouldApplyDefaultView"
```
Expected: FAIL, `shouldApplyDefaultView` is not exported.

- [ ] **Step 3: Add the gate**

In `src/lib/feed-filters.ts`, next to `isFeedEmpty`:

```ts
/**
 * Whether a bare /feed visit should open on the default view (High Conviction) rather than
 * the whole library. True when no filter param is set and the explicit show-all escape
 * (?all=1) is absent. Cosmetic params (sort, density, view, limit) do not count as filters,
 * so they leave the default in place, matching isFeedEmpty.
 */
export function shouldApplyDefaultView(sp: SearchParams): boolean {
  if (first(sp.all) === "1") return false;
  return isFeedEmpty(sp);
}
```

- [ ] **Step 4: Apply the default view on the page**

In `src/app/(shell)/feed/page.tsx`, after `savedFilters` is loaded and `resolveFeedCriteria(sp)` is read, apply High Conviction's criteria when the gate is true. Replace the block that builds `minScore, minViews, sinceDays` and the `filters` object (lines 26-39) with:

```tsx
  const applyDefault = shouldApplyDefaultView(sp);
  const highConviction = savedFilters.find((f) => f.name === "High Conviction")?.criteria as
    | { minScore?: number; minViews?: number; sinceDays?: number }
    | undefined;

  const resolved = resolveFeedCriteria(sp);
  const minScore = applyDefault ? highConviction?.minScore ?? resolved.minScore : resolved.minScore;
  const minViews = applyDefault ? highConviction?.minViews ?? resolved.minViews : resolved.minViews;
  const sinceDays = applyDefault ? highConviction?.sinceDays ?? resolved.sinceDays : resolved.sinceDays;

  const filters: FeedFilters = {
    fleetId: first(sp.fleet),
    platform: first(sp.platform) as FeedFilters["platform"],
    minScore,
    minViews,
    sinceDays,
    followerBand: bandOrAny(sp.band),
    query: first(sp.q),
    sort: (first(sp.sort) as FeedSort | undefined) ?? "score",
    limit: num(sp.limit) ?? DEFAULT_LIMIT,
    offset: 0,
  };
```

Import `shouldApplyDefaultView` from `@/lib/feed-filters` at the top.

- [ ] **Step 5: Add the show-all header and fix the empty-state escape**

When the default view is active, tell the user and offer show-all. Replace the results count line (lines 140-142) so it names the view and links to show-all:

```tsx
            <div className="mb-3 flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                <span data-num="1">{total}</span> result{total === 1 ? "" : "s"}
              </span>
              {applyDefault && (
                <>
                  <span className="text-faint">High Conviction view</span>
                  <Link href="/feed?all=1" className="text-foreground underline underline-offset-2">
                    Show all
                  </Link>
                </>
              )}
            </div>
```

And when the default view returns nothing (a tracker with no strong outliers), the "Clear filters" escape must go to show-all, not back to a bare /feed that re-applies the default and loops. In the `filteredZero` branch (lines 128-137), when `applyDefault` is true, point the link at `/feed?all=1` with copy that says the High Conviction view is empty. Change that branch to:

```tsx
        ) : filteredZero ? (
          <div className="max-w-[52ch] py-16">
            <p className="text-lg text-foreground">
              {applyDefault ? "No post clears the High Conviction bar yet." : "No post matches this slice."}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {applyDefault
                ? "Show all posts, or widen the view once more channels are synced."
                : "Try widening the score threshold, timeframe, or follower band."}
            </p>
            <Link href={applyDefault ? "/feed?all=1" : "/feed"} className={cn(buttonVariants({ variant: "default" }), "mt-8")}>
              {applyDefault ? "Show all" : "Clear filters"}
            </Link>
          </div>
```

- [ ] **Step 6: Typecheck, lint, and run the tests**

```bash
export PATH="/opt/homebrew/bin:$PATH"
npm run typecheck
npm run lint
node_modules/.bin/vitest run src/lib/feed-filters.test.ts
```
Expected: tsc clean, lint 0, the gate tests pass. The page wiring itself is a server component with no render test (repo norm); it is verified in the browser QA pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/feed-filters.ts src/lib/feed-filters.test.ts src/app/\(shell\)/feed/page.tsx
git commit -m "feat(feed): open a bare feed on High Conviction with a show-all escape"
```

---

## Final verification

- [ ] `npm run lint` 0 errors, `npm run typecheck` clean, `npm test` green.
- [ ] `npm run db:migrate` reports up to date.
- [ ] Browser QA (deferred): a bare /feed shows the High Conviction view with a Show all link; Show all shows the full library; a URL with a filter param still applies that param.

## Self-review notes

- Spec coverage: this plan is M3-U5 (Task 1) and M3-U1 (Task 2). The other M3 units are deliberately in separate plans: U2 toolbar grouping and U3 list virtualization in M3a part 2 (the feed UI, which adds a virtualization dependency), and U4 dashboard slice, U6 charts, U7 what-changed in M3b (dashboard). Each of the three plans ships independently.
- Task 1 relies on the existing feed ordering test at feed.test.ts:201 to prove dropping the null key did not change order, plus a new EXPLAIN QUERY PLAN assertion that the index is used.
- Task 2's testable unit is the pure `shouldApplyDefaultView` gate; the page wiring is verified in the browser, per the repo norm of not render-testing server components.
- Confirm during Task 1 Step 1: the real seed-helper name in feed.test.ts (it seeds channel plus video rows for its ordering tests already); reuse that rather than the placeholder `seedScored`.
- Confirm during Task 2 Step 1: whether `src/lib/feed-filters.test.ts` exists; if it does, append the describe block, otherwise create the file.
- The High Conviction criteria are read from the already-loaded savedFilters rather than hardcoded, so a future change to the seed flows through without touching the page.
