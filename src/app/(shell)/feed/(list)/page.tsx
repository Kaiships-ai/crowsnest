import Link from "next/link";

import { FeedGrid } from "@/components/feed/feed-grid";
import { FilterBar } from "@/components/feed/filter-bar";
import { buttonVariants } from "@/components/ui/button";
import { bandOrAny, defaultViewCriteria, first, num, resolveFeedCriteria, shouldApplyDefaultView, type SearchParams } from "@/lib/feed-filters";
import { cn } from "@/lib/utils";
import { getChannelsList, getFleets } from "@/server/queries/channels";
import { bumpFeedLastVisit } from "@/server/queries/dashboard";
import { getFeedBandCounts, getOutlierFeed, getSavedFilters, type FeedFilters, type FeedSort } from "@/server/queries/feed";

const DEFAULT_LIMIT = 24;
const LOAD_MORE_STEP = 24;

// Topbar already renders this route's h1 ("Outlier Feed") — see nav-items/topbar's
// ROUTE_TITLES — so page content here starts at h2 or plain text (M6).
export default async function FeedPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;

  // Landing on Feed means the creator is seeing the current outliers, so move the "new
  // since last visit" cutoff to now: the sidebar's amber Feed cue counts against this, and
  // is what clears it once they arrive. Fire-and-forget relative to the reads below — the
  // cue is read in the layout on the next navigation, never off this same render.
  await bumpFeedLastVisit();

  const [fleets, savedFilters, allChannels] = await Promise.all([getFleets(), getSavedFilters(), getChannelsList()]);

  // A bare /feed visit opens on the High Conviction view rather than the whole library —
  // the point of the tool is the outliers, not the archive. `?all=1` is the explicit
  // escape back to everything. Once the URL carries a *filter* param (see
  // FILTER_PARAM_KEYS in @/lib/feed-filters), that intent (including an explicit "any",
  // i.e. no condition) is respected as-is. Cosmetic params (density, view, sort, limit)
  // aren't filters, so a density toggle alone still reads as bare.
  //
  // `resolveFeedCriteria` is the ONE place this default gets applied (FEED-Q1) — the
  // criteria come off the seeded saved-filter row via `defaultViewCriteria`, not a
  // literal here, and `resolve-feed-nav.ts` calls the same two functions with the same
  // saved filters so the detail page's prev/next never disagrees with this page.
  const applyDefault = shouldApplyDefaultView(sp);
  const resolved = resolveFeedCriteria(sp, defaultViewCriteria(savedFilters));

  const filters: FeedFilters = {
    fleetId: first(sp.fleet),
    platform: first(sp.platform) as FeedFilters["platform"],
    minScore: resolved.minScore,
    minViews: resolved.minViews,
    sinceDays: resolved.sinceDays,
    followerBand: bandOrAny(sp.band),
    query: first(sp.q),
    minEngagement: resolved.minEngagement,
    analyzed: resolved.analyzed,
    sort: (first(sp.sort) as FeedSort | undefined) ?? "score",
    limit: num(sp.limit) ?? DEFAULT_LIMIT,
    offset: 0,
  };

  // Band counts are computed under every OTHER active filter, followerBand itself
  // excluded — that's the whole point of the chips (v1-scope.md Feed AC 6): picking
  // "Micro" doesn't change what "Nano" would have shown.
  const [{ items, total }, bandCounts] = await Promise.all([
    getOutlierFeed(filters),
    getFeedBandCounts({
      fleetId: filters.fleetId,
      platform: filters.platform,
      minScore: filters.minScore,
      minViews: filters.minViews,
      sinceDays: filters.sinceDays,
      query: filters.query,
    }),
  ]);

  const trueEmpty = allChannels.length === 0;
  // Channels exist but not one of them has ever completed a sync — there is no
  // median for anything to be measured against yet, distinct from "channels exist,
  // this filter slice just came back empty" (prototype feed.html's noPosts vs
  // feedEmpty split, lines 42-55).
  const neverSynced = !trueEmpty && total === 0 && allChannels.every((c) => c.lastSyncedAt === null);
  const filteredZero = !trueEmpty && !neverSynced && total === 0;
  // A search that comes back empty is a different fact than a filter combination that
  // does: the fix is "try other words", not "widen the score threshold" — so it needs
  // its own copy and its own recovery action (clear only the search, keep the rest of
  // the slice) rather than folding into the generic filtered-zero state.
  const searchZero = filteredZero && Boolean(filters.query && filters.query.trim());
  const hasMore = items.length < total;

  const loadMoreParams = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    const s = first(value);
    if (s) loadMoreParams.set(key, s);
  }
  loadMoreParams.set("limit", String(filters.limit + LOAD_MORE_STEP));

  const clearSearchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (key === "q") continue;
    const s = first(value);
    if (s) clearSearchParams.set(key, s);
  }

  return (
    <div className="flex h-full flex-col">
      <FilterBar
        fleets={fleets}
        savedFilters={savedFilters}
        bandCounts={bandCounts}
        applied={{ minScore: filters.minScore ?? null, minViews: filters.minViews ?? null, sinceDays: filters.sinceDays ?? null }}
      />

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {trueEmpty ? (
          <div className="max-w-[48ch] py-16">
            <p className="text-lg text-foreground">Nothing to score yet.</p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Add a channel and run a sync — posts appear here once they have a median to be measured against.
            </p>
            <Link href="/channels" className={cn(buttonVariants({ variant: "default" }), "mt-8")}>
              Add a channel
            </Link>
          </div>
        ) : neverSynced ? (
          <div className="max-w-[48ch] py-16">
            <p className="text-lg text-foreground">Nothing to score yet.</p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {allChannels.length} channel{allChannels.length === 1 ? "" : "s"} added, none synced yet — run a sync
              from Channels to pull posts and build a baseline.
            </p>
            <Link href="/channels" className={cn(buttonVariants({ variant: "default" }), "mt-8")}>
              Go to channels
            </Link>
          </div>
        ) : searchZero ? (
          <div className="max-w-[52ch] py-16">
            <p className="text-lg text-foreground">No post matches &ldquo;{filters.query}&rdquo;.</p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Try different words, or clear the search to see the rest of this slice.
            </p>
            <Link
              href={`/feed?${clearSearchParams.toString()}`}
              className={cn(buttonVariants({ variant: "default" }), "mt-8")}
            >
              Clear search
            </Link>
          </div>
        ) : filteredZero ? (
          // With the default view on, the escape has to be /feed?all=1, not a bare /feed —
          // a bare /feed re-applies High Conviction and lands the user right back on this
          // same empty state, a loop with no way out.
          <div className="max-w-[52ch] py-16">
            <p className="text-lg text-foreground">
              {applyDefault ? "No post clears the High Conviction bar yet." : "No post matches this slice."}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {applyDefault
                ? "Show all posts, or come back once more channels are synced."
                : "Try widening the score threshold, timeframe, or follower band."}
            </p>
            <Link
              href={applyDefault ? "/feed?all=1" : "/feed"}
              className={cn(buttonVariants({ variant: "default" }), "mt-8")}
            >
              {applyDefault ? "Show all" : "Clear filters"}
            </Link>
          </div>
        ) : (
          <>
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
            <FeedGrid items={items} />
            {hasMore && (
              <div className="mt-6 flex justify-center">
                <Link
                  href={`/feed?${loadMoreParams.toString()}`}
                  scroll={false}
                  className={cn(buttonVariants({ variant: "outline" }))}
                >
                  Load more
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
