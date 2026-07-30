import Link from "next/link";

import { FeedGrid } from "@/components/feed/feed-grid";
import { FilterBar } from "@/components/feed/filter-bar";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getChannelsList, getFleets } from "@/server/queries/channels";
import { getOutlierFeed, getSavedFilters, type FeedFilters, type FeedSort } from "@/server/queries/feed";

const DEFAULT_LIMIT = 24;
const LOAD_MORE_STEP = 24;

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
function num(v: string | string[] | undefined): number | undefined {
  const s = first(v);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
function criteriaNum(criteria: Record<string, unknown> | undefined, key: string): number | undefined {
  const v = criteria?.[key];
  return typeof v === "number" ? v : undefined;
}

// Topbar already renders this route's h1 ("Outlier Feed") — see nav-items/topbar's
// ROUTE_TITLES — so page content here starts at h2 or plain text (M6).
export default async function FeedPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // "Balanced" only applies on a truly bare /feed visit — once the URL carries any
  // filter param, the user's exact intent (including "no minScore") is respected as-is.
  const isEmpty = Object.keys(sp).length === 0;

  const [fleets, savedFilters, allChannels] = await Promise.all([getFleets(), getSavedFilters(), getChannelsList()]);
  const balanced = savedFilters.find((f) => f.isSystem && f.name === "Balanced");

  const filters: FeedFilters = {
    fleetId: first(sp.fleet),
    platform: first(sp.platform) as FeedFilters["platform"],
    minScore: isEmpty ? criteriaNum(balanced?.criteria, "minScore") : num(sp.minScore),
    minViews: isEmpty ? criteriaNum(balanced?.criteria, "minViews") : num(sp.minViews),
    sinceDays: isEmpty ? criteriaNum(balanced?.criteria, "sinceDays") : num(sp.since),
    followerBand: first(sp.band) as FeedFilters["followerBand"],
    sort: (first(sp.sort) as FeedSort | undefined) ?? "score",
    limit: num(sp.limit) ?? DEFAULT_LIMIT,
    offset: 0,
  };

  const { items, total } = await getOutlierFeed(filters);

  const trueEmpty = allChannels.length === 0;
  // Channels exist but not one of them has ever completed a sync — there is no
  // median for anything to be measured against yet, distinct from "channels exist,
  // this filter slice just came back empty" (prototype feed.html's noPosts vs
  // feedEmpty split, lines 42-55).
  const neverSynced = !trueEmpty && total === 0 && allChannels.every((c) => c.lastSyncedAt === null);
  const filteredZero = !trueEmpty && !neverSynced && total === 0;
  const hasMore = items.length < total;

  const loadMoreParams = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    const s = first(value);
    if (s) loadMoreParams.set(key, s);
  }
  loadMoreParams.set("limit", String(filters.limit + LOAD_MORE_STEP));

  return (
    <div className="flex h-full flex-col">
      <FilterBar fleets={fleets} savedFilters={savedFilters} />

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
        ) : filteredZero ? (
          <div className="max-w-[52ch] py-16">
            <p className="text-lg text-foreground">No post matches this slice.</p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Try widening the score threshold, timeframe, or follower band.
            </p>
            <Link href="/feed" className={cn(buttonVariants({ variant: "default" }), "mt-8")}>
              Clear filters
            </Link>
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              <span data-num="1">{total}</span> results
            </p>
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
