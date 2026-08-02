import type { FeedNav } from "@/components/video/video-detail";
import { bandOrAny, filterQuerySuffix, first, resolveFeedCriteria, type SearchParams } from "@/lib/feed-filters";
import { getOutlierFeed, type FeedFilters, type FeedSort } from "@/server/queries/feed";

/**
 * "The current feed order" (V1 scope §2, Video detail criterion 11) reconstructed from
 * whatever filter params rode along on the URL — the same param names feed/page.tsx
 * reads (fleet/platform/minScore/minViews/since/band/sort/q). A bare `/feed/[id]` visit
 * (no params — a bookmark, the sidebar's last-viewed list, a dashboard/channel grid, a
 * Vault card, or a link this slice doesn't control) resolves against the full raw
 * library, the same default feed/page.tsx now shows on a bare `/feed` visit. That's why
 * this file no longer needs the old Balanced-then-unfiltered fallback: bare already means
 * the whole library, so any real post is found in one pass.
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
 * Same `searchParams -> criteria` resolution feed/page.tsx uses, via the shared
 * `resolveFeedCriteria` (`@/lib/feed-filters`) — NOT a parallel, drift-prone copy. Before
 * this (multipage-fix-plan.md finding 1), this file had its own `buildFeedFilters` with
 * its own param logic that drifted from the feed's own resolution.
 */
export function buildFeedFilters(sp: SearchParams): FeedFilters {
  const { minScore, minViews, sinceDays } = resolveFeedCriteria(sp);
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

export async function resolveFeedNav(videoId: string, sp: SearchParams): Promise<FeedNav> {
  // `filterQuerySuffix` (not a raw `Object.entries(sp)` walk) so purely cosmetic
  // params (`density`, `view`, `limit`) never ride along on the back/prev/next hrefs,
  // while `sort` (an order, not a filter — see ORDER_PARAM_KEYS) does — the same
  // builder `feed-grid.tsx` uses to forward the feed's state into this page in the
  // first place, so the two halves can never disagree on what to carry.
  const suffix = filterQuerySuffix(sp);
  const hrefFor = (id: string) => `/feed/${id}${suffix}`;

  const { items: resolved } = await getOutlierFeed(buildFeedFilters(sp));
  const index = resolved.findIndex((it) => it.videoId === videoId);

  if (index === -1) {
    // The post doesn't match whatever filter rode along on the URL, or the install has
    // passed FEED_ORDER_LIMIT posts. Either way, a made-up position is worse than none:
    // no index label, no adjacency.
    return { backHref: `/feed${suffix}`, prevHref: null, nextHref: null, indexLabel: null };
  }

  return {
    backHref: `/feed${suffix}`,
    prevHref: index > 0 ? hrefFor(resolved[index - 1].videoId) : null,
    nextHref: index < resolved.length - 1 ? hrefFor(resolved[index + 1].videoId) : null,
    indexLabel: `${index + 1} of ${resolved.length}`,
  };
}
