# Reel view count enrichment implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill `videos.view_count` for tracked reels by asking Instagram's single-media endpoint for the play count the listing endpoint refuses to give.

**Architecture:** The sidecar already exposes `POST /media-stats` and the TypeScript client already exposes `igClient.fetchMediaStats(pk)`, both built and tested. What remains is a paced enrichment pass inside `syncOneChannel`, running after the page walk and before `recomputeChannelScores`, so the scores the sync computes already see the enriched numbers. It is opt-in and off by default, because every enriched reel is one more live request from the burner account.

**Tech Stack:** Next.js 16, drizzle with better-sqlite3, vitest, FastAPI plus instagrapi in `services/ig`.

## Global constraints

- No schema change. No migration, no DDL, no `sqlite3` write against `data/crowsnest.db`. Announce to the orchestrator before any of those.
- `src/server/services/sync-engine.ts` is outside the `src/server/ig/*` scope originally assigned. It is unavoidable, see "Why this cannot live in a new file" below. Confirm ownership with the orchestrator before Task 3.
- Do not add a value to `SYNC_PHASES` in `src/server/services/sync-types.ts`. That is a wire contract shared with client components, and a sibling agent is active on UI.
- Do not stage `CLAUDE.md` or `.claude/hooks/humanizer-doc-check.sh`. Those are modified by someone else.
- Only `product_type: clips` is proven. The spike confirmed four reels across four channels and tested nothing else.
- `play_count` is the field with signal. `view_count` was 0 on every reel measured, including on the single-media call.

## Why this cannot live in a new file

`src/server/services/score-recompute-guard.test.ts` is a structural test that fails when any file outside its allow-list writes `tables.videos`. The allow-list is exactly `server/services/sync-engine.ts` and `server/actions/media-actions.ts`. `view_count` is the column outlier scores are computed from, so a new file writing it would fail that guard on purpose, and widening the allow-list would mean taking on the recompute obligation by hand.

Putting the pass in `sync-engine.ts` immediately before the existing `recomputeChannelScores(channel.id)` call inherits the recompute for free and keeps the guard green with no edit to its allow-list.

## Already built, do not redo

- `services/ig/crowsnest_ig/models.py`: `MediaStatsRequest`, `MediaStatsResponse`.
- `services/ig/crowsnest_ig/app.py`: `POST /media-stats`, calling `client.media_info_v1(pk)` explicitly.
- `src/server/ig/client.ts`: `IgMediaStats` interface and `igClient.fetchMediaStats(pk)`.
- `src/server/ig/client.test.ts`: three `fetchMediaStats` tests plus a zero-is-not-disclosed regression test for `mapMedia`.

Verified green: `npx vitest run src/server/ig/client.test.ts` (29 passed) and `services/ig/.venv/bin/python -m pytest tests/ -q` (161 passed).

## File structure

| File | Change | Responsibility |
| --- | --- | --- |
| `src/server/config.ts` | Modify, near line 59 | One knob, `VIEW_COUNT_ENRICH_PER_CHANNEL`, default 0 |
| `src/server/services/sync-engine.ts` | Modify | Candidate query, enrichment loop, call site in `syncOneChannel` |
| `src/server/services/sync-engine.test.ts` | Modify | Behavior tests for the loop |

---

### Task 1: The candidate query and its knob

**Files:**
- Modify: `src/server/config.ts` (near the `EAGER_VIDEO_DOWNLOAD` entry at line 59)
- Modify: `src/server/services/sync-engine.ts` (new function beside `upsertVideo`, around line 668)
- Test: `src/server/services/sync-engine.test.ts`

**Interfaces:**
- Consumes: `tables.videos`, and the drizzle helpers `and` / `eq` / `isNull` / `desc` already imported at the top of `sync-engine.ts`. Check `desc` is among them and add it to the existing import if not.
- Produces: `enrichmentCandidates(channelId: string, limit: number): Promise<{ id: string; externalId: string }[]>`, newest first. Not exported.

- [ ] **Step 1: Add a seeding helper**

`sync-engine.test.ts` has no video-seeding helper. It has `setupChannel(handle): Promise<{ channelId }>`, `makeMedia(id, daysAgo, over)`, `isoDaysAgo(days)`, `stubClient(opts)`, and `noopSleep`, and it inserts videos inline with `db.insert(tables.videos).values({...})` (see the soft-delete describe block around line 336 for the exact column set).

Add this beside `setupChannel`, matching that inline insert:

```ts
/** A reel row shaped like one the sync would have written from a listing page: no view
 *  count, because the listing endpoint withholds play counts for media the burner does
 *  not own. */
async function seedReel(
  channelId: string,
  externalId: string,
  over: { daysAgo?: number; viewCount?: number | null; productType?: string | null; deletedAt?: string | null } = {}
): Promise<void> {
  const { db, newId, nowIso, tables } = await import("../db");
  await db.insert(tables.videos).values({
    id: newId(),
    channelId,
    platform: "instagram",
    externalId,
    url: `https://www.instagram.com/reel/${externalId}/`,
    mediaType: "video",
    productType: over.productType === undefined ? "clips" : over.productType,
    postedAt: isoDaysAgo(over.daysAgo ?? 1),
    viewCount: over.viewCount ?? null,
    deletedAt: over.deletedAt ?? null,
    firstSeenAt: nowIso(),
  });
}
```

- [ ] **Step 2: Write the failing test**

Every test in this file calls `migrate()` and imports through `await import(...)`. Follow that, do not add module-level imports of `../db`.

```ts
describe("view count enrichment — candidates", () => {
  test("the newest live reels, with deleted and non-reel rows excluded", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@probe");

    await seedReel(channelId, "old", { daysAgo: 30 });
    await seedReel(channelId, "new", { daysAgo: 2 });
    await seedReel(channelId, "gone", { daysAgo: 1, deletedAt: "2026-08-02T10:47:25.371Z" });
    await seedReel(channelId, "photo", { daysAgo: 1, productType: "feed" });

    const { __test } = await import("./sync-engine");
    const rows = await __test.enrichmentCandidates(channelId, 10);

    // A soft-deleted row raises MediaNotFound if asked about, correctly: a prior sync
    // already saw it removed from Instagram. Exactly one of 299 dev rows is in that
    // state, and the first spike probe picked it first try and read the error as a block.
    expect(rows.map((r) => r.externalId)).toEqual(["new", "old"]);
  });

  test("the limit caps how many reels a sync will ask about", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@capped");

    await seedReel(channelId, "a", { daysAgo: 1 });
    await seedReel(channelId, "b", { daysAgo: 2 });

    const { __test } = await import("./sync-engine");
    expect(await __test.enrichmentCandidates(channelId, 1)).toHaveLength(1);
    expect(await __test.enrichmentCandidates(channelId, 0)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx vitest run src/server/services/sync-engine.test.ts -t "enrichment"`
Expected: FAIL, `__test.enrichmentCandidates is not a function`.

- [ ] **Step 4: Add the knob**

In `src/server/config.ts`, beside `EAGER_VIDEO_DOWNLOAD`:

```ts
  /** How many of a channel's newest reels each sync asks Instagram about individually,
   *  to get the play count the listing endpoint withholds. 0 disables the pass.
   *
   *  Off by default on purpose: this is one extra live request per reel per sync, from a
   *  burner account, and instagrapi retries public requests up to three times internally,
   *  so the real HTTP count runs above the reel count. See
   *  docs/product/reel-view-count-spike.md. */
  VIEW_COUNT_ENRICH_PER_CHANNEL: intWithDefault(0, 0, 200),
```

- [ ] **Step 5: Add the query**

In `src/server/services/sync-engine.ts`, directly above `upsertVideo`:

```ts
/** The reels an enrichment pass should ask about, newest first.
 *
 *  Scoped to `clips`. That is the only `product_type` the spike confirmed carries a real
 *  play count on the single-media endpoint, and asking about anything else spends a live
 *  request to learn nothing.
 *
 *  Rows with `deletedAt` set are excluded because a prior sync already saw them removed
 *  from Instagram, so the endpoint answers `MediaNotFound`, correctly.
 *
 *  Deliberately NOT filtered to rows where `viewCount` is null. A play count grows after
 *  a post lands, so the newest reels are worth re-reading even when they already carry a
 *  number. Freshness on the reels the user actually looks at is the point of the cap. */
async function enrichmentCandidates(channelId: string, limit: number): Promise<{ id: string; externalId: string }[]> {
  if (limit <= 0) return [];
  return db
    .select({ id: tables.videos.id, externalId: tables.videos.externalId })
    .from(tables.videos)
    .where(
      and(
        eq(tables.videos.channelId, channelId),
        eq(tables.videos.productType, "clips"),
        isNull(tables.videos.deletedAt)
      )
    )
    .orderBy(desc(tables.videos.postedAt))
    .limit(limit);
}
```

If `sync-engine.ts` already has a `__test` export block, add `enrichmentCandidates` to it. If it does not, add one at the end of the file:

```ts
/** Internals reachable from tests only. */
export const __test = { enrichmentCandidates };
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run src/server/services/sync-engine.test.ts -t "enrichment"`
Expected: PASS, both tests.

- [ ] **Step 7: Commit**

```bash
git add src/server/config.ts src/server/services/sync-engine.ts src/server/services/sync-engine.test.ts
git commit -m "feat(sync): select newest live reels for view count enrichment"
```

---

### Task 2: The paced enrichment loop

**Files:**
- Modify: `src/server/services/sync-engine.ts`
- Test: `src/server/services/sync-engine.test.ts`

**Interfaces:**
- Consumes: `enrichmentCandidates` from Task 1. `igClient.fetchMediaStats(pk): Promise<IgMediaStats>` from `src/server/ig/client.ts`, where `IgMediaStats` is `{ externalId, mediaType, productType, viewCount, likeCount, commentCount }`. The existing `jitterMs()` and `errorCode(err)` helpers in `sync-engine.ts`.
- Produces: `enrichViewCounts(channelId: string, deps: { client: Pick<IgClient, "fetchMediaStats">; sleep: (ms: number) => Promise<void>; limit: number }): Promise<{ enriched: number; skipped: number; stopped: boolean }>`. Not exported except through `__test`.

- [ ] **Step 1: Write the failing tests**

Add a local helper at the top of this describe block, so each test states only what it varies:

```ts
describe("view count enrichment — the pass", () => {
  /** The stats shape `igClient.fetchMediaStats` resolves to. Numbers are a real
   *  measurement: @jun_yuh reel 3953894690809843161. */
  function stats(externalId: string, viewCount: number | null) {
    return { externalId, mediaType: "video" as const, productType: "clips", viewCount, likeCount: 77_918, commentCount: 389 };
  }

  async function viewCountOf(externalId: string): Promise<number | null> {
    const { db, tables } = await import("../db");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select({ viewCount: tables.videos.viewCount })
      .from(tables.videos)
      .where(eq(tables.videos.externalId, externalId))
      .limit(1);
    return rows[0].viewCount;
  }

  test("writes the play count the listing endpoint withheld", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@enrich");
    await seedReel(channelId, "3953894690809843161", { viewCount: null });

    const { __test } = await import("./sync-engine");
    const result = await __test.enrichViewCounts(channelId, {
      client: { fetchMediaStats: async (pk: string) => stats(pk, 1_212_937) },
      sleep: noopSleep,
      limit: 5,
    });

    expect(result.enriched).toBe(1);
    expect(await viewCountOf("3953894690809843161")).toBe(1_212_937);
  });

  test("a null count never erases a number we already have", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@keep");
    await seedReel(channelId, "kept", { viewCount: 2_270_000 });

    // fetchMediaStats already maps a zero to null, so this is what a withheld count looks
    // like by the time it reaches here. Writing it would repeat the bug that once turned
    // a genuine 2.27M-view reel into 0 and zeroed every outlier score.
    const { __test } = await import("./sync-engine");
    const result = await __test.enrichViewCounts(channelId, {
      client: { fetchMediaStats: async (pk: string) => stats(pk, null) },
      sleep: noopSleep,
      limit: 5,
    });

    expect(result.enriched).toBe(0);
    expect(await viewCountOf("kept")).toBe(2_270_000);
  });

  test("a deleted media is skipped and the pass continues", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@partly-gone");
    await seedReel(channelId, "gone", { daysAgo: 1 });
    await seedReel(channelId, "live", { daysAgo: 2 });

    const { IgError } = await import("../ig/errors");
    const { __test } = await import("./sync-engine");
    const result = await __test.enrichViewCounts(channelId, {
      client: {
        fetchMediaStats: async (pk: string) => {
          if (pk === "gone") throw new IgError("IG_NOT_FOUND", "Media not found or unavailable");
          return stats(pk, 94_988);
        },
      },
      sleep: noopSleep,
      limit: 5,
    });

    // IG_NOT_FOUND on one reel means that one post is gone, not that the account is
    // blocked. The first spike probe aborted on exactly this and read it as a possible
    // ban, which cost a whole confirmation run.
    expect(result.skipped).toBe(1);
    expect(result.enriched).toBe(1);
    expect(result.stopped).toBe(false);
  });

  test("any other error stops the pass without failing the sync", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@limited");
    await seedReel(channelId, "first", { daysAgo: 1 });
    await seedReel(channelId, "second", { daysAgo: 2 });

    const { IgError } = await import("../ig/errors");
    const { __test } = await import("./sync-engine");
    let calls = 0;
    const result = await __test.enrichViewCounts(channelId, {
      client: {
        fetchMediaStats: async () => {
          calls += 1;
          throw new IgError("IG_RATE_LIMITED", "Please wait a few minutes");
        },
      },
      sleep: noopSleep,
      limit: 5,
    });

    // Rate limiting is the signal to back off entirely, and it must not throw: the page
    // walk already did the sync's real work, and losing a whole channel over a view count
    // is the trade this file refuses everywhere else.
    expect(calls).toBe(1);
    expect(result.stopped).toBe(true);
    expect(result.enriched).toBe(0);
  });

  test("requests are paced apart", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@paced");
    await seedReel(channelId, "a", { daysAgo: 1 });
    await seedReel(channelId, "b", { daysAgo: 2 });

    const { __test } = await import("./sync-engine");
    const sleeps: number[] = [];
    await __test.enrichViewCounts(channelId, {
      client: { fetchMediaStats: async (pk: string) => stats(pk, 10) },
      sleep: async (ms: number) => { sleeps.push(ms); },
      limit: 5,
    });

    // One gap between two reels, none before the first.
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/server/services/sync-engine.test.ts -t "enrich"`
Expected: FAIL, `__test.enrichViewCounts is not a function`.

- [ ] **Step 3: Write the loop**

In `src/server/services/sync-engine.ts`, below `enrichmentCandidates`:

```ts
/** Asks Instagram about each of a channel's newest reels individually, to get the play
 *  count the listing endpoint withholds.
 *
 *  Runs before `recomputeChannelScores` so the scores this sync computes already see the
 *  numbers this pass wrote. That ordering is also why the pass lives in this file at all:
 *  `score-recompute-guard.test.ts` allows only this file and `media-actions.ts` to write
 *  `tables.videos`, and `view_count` is the column scores derive from.
 *
 *  Never throws. The page walk has already done the sync's real work by the time this
 *  runs, and failing a whole channel over a view count would trade a gap in the feed for
 *  a vanity metric. */
async function enrichViewCounts(
  channelId: string,
  deps: { client: Pick<IgClient, "fetchMediaStats">; sleep: (ms: number) => Promise<void>; limit: number }
): Promise<{ enriched: number; skipped: number; stopped: boolean }> {
  const candidates = await enrichmentCandidates(channelId, deps.limit);
  let enriched = 0;
  let skipped = 0;

  for (const [index, row] of candidates.entries()) {
    // Paced apart, and never before the first request.
    if (index > 0) await deps.sleep(jitterMs());

    let stats: IgMediaStats;
    try {
      stats = await deps.client.fetchMediaStats(row.externalId);
    } catch (err) {
      if (errorCode(err) === "IG_NOT_FOUND") {
        // That one post is gone from Instagram. A prior sync may not have noticed yet.
        skipped += 1;
        continue;
      }
      log.warn("sync.enrich.stopped", {
        channelId,
        externalId: row.externalId,
        code: errorCode(err),
        enriched,
        skipped,
        reason: "upstream said stop; leaving the rest for the next sync",
      });
      return { enriched, skipped, stopped: true };
    }

    // `fetchMediaStats` already maps a zero to null. Writing that null would repeat the
    // bug that turned a genuine 2.27M-view reel into 0 on the first live run.
    if (stats.viewCount == null) continue;

    await db
      .update(tables.videos)
      .set({ viewCount: stats.viewCount, lastRefreshedAt: nowIso() })
      .where(eq(tables.videos.id, row.id));
    enriched += 1;
  }

  return { enriched, skipped, stopped: false };
}
```

Add `enrichViewCounts` to the `__test` export from Task 1. Add `IgMediaStats` and `IgClient` to the existing type import from `../ig/client` at the top of the file.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/server/services/sync-engine.test.ts -t "enrich"`
Expected: PASS, all five.

- [ ] **Step 5: Confirm the structural guard is still green**

Run: `npx vitest run src/server/services/score-recompute-guard.test.ts`
Expected: PASS. The new write is in an already allow-listed file, so the allow-list needs no edit. If this fails, stop and re-read the guard's header comment rather than widening the list.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/sync-engine.ts src/server/services/sync-engine.test.ts
git commit -m "feat(sync): paced view count enrichment pass"
```

---

### Task 3: Wire it into the channel sync

**Files:**
- Modify: `src/server/services/sync-engine.ts`, in `syncOneChannel`, between the soft-delete block ending near line 1097 and `await tracker.flush({ phase: "scoring", counters })` near line 1099
- Test: `src/server/services/sync-engine.test.ts`

**Interfaces:**
- Consumes: `enrichViewCounts` from Task 2, `config.VIEW_COUNT_ENRICH_PER_CHANNEL` from Task 1.
- Produces: no new exported surface. The observable change is that `recomputeChannelScores` sees enriched numbers.

**Coordination gate:** confirm with the orchestrator that editing `syncOneChannel` is in scope before starting. A sibling agent works in the same directory.

- [ ] **Step 1: Write the failing test**

```ts
describe("view count enrichment — ordering and default", () => {
  test("scores are computed from the enriched numbers, not the withheld zeros", async () => {
    // The whole point of running before the recompute. If enrichment ran after scoring, a
    // sync would show the number in the feed but score it as though the count were
    // missing, and the score would only correct itself on the following sync.
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@ordered");
    await seedReel(channelId, "r1", { viewCount: null });

    const { __test, recomputeChannelScores } = await import("./sync-engine");
    await __test.enrichViewCounts(channelId, {
      client: {
        fetchMediaStats: async (pk: string) => ({
          externalId: pk, mediaType: "video" as const, productType: "clips",
          viewCount: 371_200, likeCount: 1, commentCount: 1,
        }),
      },
      sleep: noopSleep,
      limit: 5,
    });

    // recomputeChannelScores returns the channel baseline, computed from view counts. A
    // single enriched reel makes it that reel's count; with the count still null there is
    // nothing to compute a baseline from.
    expect(await recomputeChannelScores(channelId)).toBe(371_200);
  });

  test("the pass is off by default and costs no requests", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@off");
    await seedReel(channelId, "r1");

    const { __test } = await import("./sync-engine");
    let calls = 0;
    const result = await __test.enrichViewCounts(channelId, {
      client: { fetchMediaStats: async () => { calls += 1; throw new Error("must not be called"); } },
      sleep: noopSleep,
      limit: 0,
    });

    expect(calls).toBe(0);
    expect(result.enriched).toBe(0);
  });
});
```

Note on the first test: confirm what `recomputeChannelScores` returns for a single-video channel before asserting an exact number. It returns `computeChannelBaseline(...)`, and `getScoringOptions()` carries a minimum-usable-posts floor from `app_settings`. If one video is below that floor the baseline is null, in which case assert `toBeNull()` on the pre-enrichment state and a non-null baseline after enriching enough reels. Read `src/server/services/scoring.ts` and adjust the assertion to what the scoring rules actually produce. Do not weaken the test to `expect(true)`.

- [ ] **Step 2: Run the tests and confirm the first fails**

Run: `npx vitest run src/server/services/sync-engine.test.ts -t "enriched numbers"`
Expected: the ordering test may already pass, since it calls the pieces directly. If it does, that is fine, it is a regression guard for the call order added in Step 3. The off-by-default test must pass immediately.

- [ ] **Step 3: Add the call site**

In `syncOneChannel`, immediately before `await tracker.flush({ phase: "scoring", counters });`:

```ts
    // Before scoring, not after: `recomputeChannelScores` below reads `videos.view_count`,
    // so a count written after it would not reach a score until the next sync.
    //
    // Off unless VIEW_COUNT_ENRICH_PER_CHANNEL is set. Each reel here is one more live
    // request from the burner, and instagrapi retries internally, so the real HTTP count
    // runs above the reel count.
    if (config.VIEW_COUNT_ENRICH_PER_CHANNEL > 0) {
      const enrichment = await enrichViewCounts(channel.id, {
        client: opts.client ?? igClient,
        sleep: opts.sleep,
        limit: config.VIEW_COUNT_ENRICH_PER_CHANNEL,
      });
      log.info("sync.enrich.finished", { channelId: channel.id, handle: channel.handle, ...enrichment });
    }
```

Match `opts.client ?? igClient` to however `syncOneChannel` already reaches the IG client. Read the surrounding code and use the same accessor rather than introducing a second one.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS. Pay attention to `score-recompute-guard.test.ts` and any existing `syncOneChannel` test that counts calls to a fake client, since the pass adds calls when the knob is on. Those tests should be unaffected because the default is 0.

- [ ] **Step 5: Run the sidecar suite**

Run: `cd services/ig && .venv/bin/python -m pytest tests/ -q`
Expected: PASS, 161 tests.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/sync-engine.ts src/server/services/sync-engine.test.ts
git commit -m "feat(sync): run view count enrichment before scoring"
```

---

### Task 4: Prove it against real Instagram, once

**Files:** none. This is a manual verification step, and it makes live requests.

**Coordination gate:** get Kai's go before running. This spends real burner requests.

- [ ] **Step 1: Start the sidecar**

Run: `npm run ig:service`
Note: dev servers started from a Bash tool call get reaped after a minute or two. Run this in a cmux pane.

- [ ] **Step 2: Enrich one channel with a small cap**

Set `VIEW_COUNT_ENRICH_PER_CHANNEL=3` in `.env.local`, sync one channel, and read the log line `sync.enrich.finished`.

Expected: `enriched: 3`, `skipped: 0`, `stopped: false`.

- [ ] **Step 3: Confirm the numbers landed**

```bash
sqlite3 -readonly data/crowsnest.db "select c.handle, v.external_id, v.view_count, v.outlier_score from videos v join channels c on c.id=v.channel_id where v.view_count is not null and c.handle != '@kallaway' order by v.last_refreshed_at desc limit 5;"
```

Expected: rows with non-null `view_count` on a channel other than @kallaway, which is the first time that has ever been true in this database.

- [ ] **Step 4: Decide the real default**

Report the observed request count and timing to Kai, and let him pick the `VIEW_COUNT_ENRICH_PER_CHANNEL` value that ships.

---

## Self-review

**Spec coverage.** The spike doc's implementation constraints map as follows: one request per reel and caller-side pacing are Task 2 Step 3, `deleted_at` filtering is Task 1 Step 4, `MediaNotFound` skip-and-continue against stop-on-anything-else is Task 2 Step 3 and its two error tests, clips-only scoping is Task 1 Step 4, and the "recent reels per channel rather than all 290" decision is the knob in Task 1 Step 3. Kai's "no provenance column" and "no backfill" answers are honored by the absence of any schema change and by the per-channel cap.

**Known gap, deliberate.** No progress phase is reported for the enrichment pass, so the UI shows the previous phase while it runs. Adding one means editing `SYNC_PHASES`, a wire contract shared with client components a sibling agent is working in. Log lines cover observability until that coordination is possible.

**Second known gap.** `likeCount` and `commentCount` come back on the same response and are discarded. Writing them is free in request terms but widens what the pass touches, and the guard test's reasoning about which columns feed scores is easier to hold when the pass writes one column. Worth revisiting once the pass has run in anger.

**Type consistency.** `IgMediaStats` fields used in the fakes throughout Tasks 2 and 3 match the interface in `src/server/ig/client.ts`: `externalId`, `mediaType`, `productType`, `viewCount`, `likeCount`, `commentCount`. The `enrichViewCounts` return shape `{ enriched, skipped, stopped }` is used identically in Task 2's tests, Task 2's implementation, and Task 3's call site.
