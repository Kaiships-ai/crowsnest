import type { FeedNav } from "@/components/video/video-detail";
import { bandOrAny, filterQuerySuffix, first, isFeedEmpty, resolveFeedCriteria, type SearchParams } from "@/lib/feed-filters";
import { getOutlierFeed, type FeedFilters, type FeedSort } from "@/server/queries/feed";

/**
 * "The current feed order" (V1 scope §2, Video detail criterion 11) reconstructed from
 * whatever filter params rode along on the URL — the same param names feed/page.tsx
 * reads (fleet/platform/minScore/minViews/since/band/sort/q). A bare `/feed/[id]` visit
 * (no params — a bookmark, the sidebar's last-viewed list, a dashboard/channel grid, a
 * Vault card, or a link this slice doesn't control) resolves against Balanced first
 * (the same default `feed/page.tsx` applies on a bare `/feed` visit), then falls back
 * to the true unfiltered order if the target post isn't in that Balanced slice — see
 * `resolveFeedNav`'s fallback below, whole-branch review finding I2.
 *
 * FEED_ORDER_LIMIT: this is a one-person, one-Mac, one-platform tool (V1 scope §0) — a
 * few thousand tracked posts is the realistic ceiling for the life of V1. Fetching that
 * many rows to find one video's neighbours is cheap on local SQLite and, unlike paging
 * through the feed's own 24-at-a-time slices, it means every post has a real prev/next
 * rather than only the ones the feed happened to have loaded. If a install ever grows
 * past this cap, the honest failure mode is what's below: the current post drops out of
 * `indexLabel` and adjacency rather than showing a wrong number.
 */
const FEED_ORDER_LIMIT = 5000;

/**
 * Same `searchParams -> criteria` resolution `feed/page.tsx` uses, via the shared
 * `resolveFeedCriteria` (`@/lib/feed-filters`) — NOT a parallel, drift-prone copy. Before
 * this (multipage-fix-plan.md finding 1), this file had its own `buildFeedFilters` with
 * its own param logic that never applied the Balanced default, so a bare detail-page
 * visit resolved to "no filter, the full library" instead of matching what the feed
 * itself would have shown.
 */
export function buildFeedFilters(sp: SearchParams, balancedCriteria: Record<string, unknown> | undefined): FeedFilters {
  const { minScore, minViews, sinceDays } = resolveFeedCriteria(sp, balancedCriteria);
  return {
    fleetId: first(sp.fleet),
    platform: first(sp.platform) as FeedFilters["platform"],
    minScore,
    minViews,
    sinceDays,
    followerBand: bandOrAny(sp.band),
    query: first(sp.q),
    sort: (first(sp.sort) as FeedSort | undefined) ?? "score",
    limit: FEED_ORDER_LIMIT,
    offset: 0,
  };
}

export async function resolveFeedNav(
  videoId: string,
  sp: SearchParams,
  balancedCriteria: Record<string, unknown> | undefined
): Promise<FeedNav> {
  // `filterQuerySuffix` (not a raw `Object.entries(sp)` walk) so purely cosmetic
  // params (`density`, `view`, `limit`) never ride along on the back/prev/next hrefs,
  // while `sort` (an order, not a filter — see ORDER_PARAM_KEYS) does — the same
  // builder `feed-grid.tsx` uses to forward the feed's state into this page in the
  // first place, so the two halves of the fix can never disagree on what to carry.
  const suffix = filterQuerySuffix(sp);
  const hrefFor = (id: string) => `/feed/${id}${suffix}`;

  const { items } = await getOutlierFeed(buildFeedFilters(sp, balancedCriteria));
  let resolved = items;
  let index = resolved.findIndex((it) => it.videoId === videoId);

  // A paramless visit resolves against Balanced, matching what `feed/page.tsx` itself
  // would show for a bare `/feed` visit. But plenty of links into this page carry no
  // filter query at all and were never meant to imply Balanced — the sidebar's
  // last-viewed list, dashboard/channel grids and calendars, Vault cards and remix
  // rails, and (worst case) the Vault empty-state "top outlier" link, which
  // deliberately reaches past Balanced's 30-day window (`getTopOutlierAllTime`). For
  // any of those, treating a real post as "not in Balanced, so no nav at all" is a
  // false negative, not an honest filtered-zero. So: only on a paramless visit
  // (`isFeedEmpty`), if the target isn't in the Balanced slice, refetch unfiltered
  // (`buildFeedFilters(sp, undefined)` — same sp, no Balanced criteria applied) and
  // resolve against that instead. A visit with a real filter query never falls back:
  // there, the post genuinely not matching the user's own filter is the correct fact.
  if (index === -1 && isFeedEmpty(sp)) {
    const unfiltered = await getOutlierFeed(buildFeedFilters(sp, undefined));
    resolved = unfiltered.items;
    index = resolved.findIndex((it) => it.videoId === videoId);
  }

  if (index === -1) {
    // Still not found — either it doesn't match whatever filter rode along on the
    // URL, or the install has passed FEED_ORDER_LIMIT posts. Either way, a made-up
    // position is worse than none: no index label, no adjacency.
    return { backHref: `/feed${suffix}`, prevHref: null, nextHref: null, indexLabel: null };
  }

  return {
    backHref: `/feed${suffix}`,
    prevHref: index > 0 ? hrefFor(resolved[index - 1].videoId) : null,
    nextHref: index < resolved.length - 1 ? hrefFor(resolved[index + 1].videoId) : null,
    indexLabel: `${index + 1} of ${resolved.length}`,
  };
}
