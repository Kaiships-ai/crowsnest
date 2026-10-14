import Link from "next/link";

import { FeedGrid } from "@/components/feed/feed-grid";
import { FilterBar } from "@/components/feed/filter-bar";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { bandOrAny, defaultViewCriteria, first, num, resolveFeedCriteria, shouldApplyDefaultView, type SearchParams } from "@/lib/feed-filters";
import { plural } from "@/lib/format";
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

      {/* The scroller stays on this route rather than the shell, so the sticky filter
          bar above pins to the top of the feed and not the top of the page. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PageContainer size="full">
          {trueEmpty ? (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyTitle>Nothing to score yet.</EmptyTitle>
                <EmptyDescription>
                  Add a channel and run a sync — posts appear here once they have a median to be measured against.
                </EmptyDescription>
              </EmptyHeader>
              {/* `nativeButton={false}` on every Button that renders a <Link>: Base UI's
                  Button assumes a real <button> otherwise and strips the anchor's own
                  semantics. */}
              <EmptyContent>
                <Button render={<Link href="/channels" />} nativeButton={false}>
                  Add a channel
                </Button>
              </EmptyContent>
            </Empty>
          ) : neverSynced ? (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyTitle>Nothing to score yet.</EmptyTitle>
                <EmptyDescription>
                  {allChannels.length} channel{allChannels.length === 1 ? "" : "s"} added, none synced yet — run a sync
                  from Channels to pull posts and build a baseline.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button render={<Link href="/channels" />} nativeButton={false}>
                  Go to channels
                </Button>
              </EmptyContent>
            </Empty>
          ) : searchZero ? (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyTitle>No post matches &ldquo;{filters.query}&rdquo;.</EmptyTitle>
                <EmptyDescription>
                  Try different words, or clear the search to see the rest of this slice.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button render={<Link href={`/feed?${clearSearchParams.toString()}`} />} nativeButton={false}>
                  Clear search
                </Button>
              </EmptyContent>
            </Empty>
          ) : filteredZero ? (
            // With the default view on, the escape has to be /feed?all=1, not a bare /feed —
            // a bare /feed re-applies High Conviction and lands the user right back on this
            // same empty state, a loop with no way out.
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyTitle>
                  {applyDefault ? "No post clears the High Conviction bar yet." : "No post matches this slice."}
                </EmptyTitle>
                <EmptyDescription>
                  {applyDefault
                    ? "Show all posts, or come back once more channels are synced."
                    : "Try widening the score threshold, timeframe, or follower band."}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button render={<Link href={applyDefault ? "/feed?all=1" : "/feed"} />} nativeButton={false}>
                  {applyDefault ? "Show all" : "Clear filters"}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>
                  <span data-num="1">{total}</span> {plural("result", total)}
                </span>
                {applyDefault && (
                  <>
                    <span className="text-muted-foreground">High Conviction view</span>
                    <Link href="/feed?all=1" className="text-foreground underline underline-offset-2">
                      Show all
                    </Link>
                  </>
                )}
              </div>
              <FeedGrid items={items} />
              {hasMore && (
                <div className="mt-6 flex justify-center">
                  <Button
                    render={<Link href={`/feed?${loadMoreParams.toString()}`} scroll={false} />}
                    nativeButton={false}
                    variant="outline"
                  >
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </PageContainer>
      </div>
    </div>
  );
}
