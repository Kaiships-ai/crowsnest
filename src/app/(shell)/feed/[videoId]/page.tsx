import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { VideoDetail } from "@/components/video/video-detail";
import type { FeedNav } from "@/components/video/video-detail";
import { hasLlmKey } from "@/server/llm/client";
import { getChannelMedianBasis } from "@/server/queries/channels";
import { getSavedPostByVideoId } from "@/server/queries/saved-posts";
import { getOutlierFeed, type FeedFilters, type FeedSort } from "@/server/queries/feed";
import { getVideoDetail, recordRecentlyViewed } from "@/server/queries/video";
import { getSimilarOutliers } from "@/server/services/similar";
import { availableTranscriptProviders } from "@/server/transcribe";

// Both generateMetadata and the page component need the same fetch this request —
// React's cache() dedupes them to a single DB round-trip.
const getCachedVideoDetail = cache(getVideoDetail);

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

/**
 * "The current feed order" (V1 scope §2, Video detail criterion 11) reconstructed from
 * whatever filter params rode along on the URL — the same param names feed/page.tsx
 * reads (fleet/platform/minScore/minViews/since/band/sort/q). A bare `/feed/[id]` visit
 * (no params — e.g. a bookmark, or a link this slice doesn't control that hasn't been
 * updated to forward them yet) still resolves to a real order: `getOutlierFeed`'s own
 * default, sorted by score, unfiltered. Never a fabricated adjacency.
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

function buildFeedFilters(sp: SearchParams): FeedFilters {
  return {
    fleetId: first(sp.fleet),
    platform: first(sp.platform) as FeedFilters["platform"],
    minScore: num(sp.minScore),
    minViews: num(sp.minViews),
    sinceDays: num(sp.since),
    followerBand: first(sp.band) as FeedFilters["followerBand"],
    query: first(sp.q),
    sort: (first(sp.sort) as FeedSort | undefined) ?? "score",
    limit: FEED_ORDER_LIMIT,
    offset: 0,
  };
}

async function resolveFeedNav(videoId: string, sp: SearchParams): Promise<FeedNav> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    const s = first(value);
    if (s) qs.set(key, s);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const hrefFor = (id: string) => `/feed/${id}${suffix}`;

  const { items } = await getOutlierFeed(buildFeedFilters(sp));
  const index = items.findIndex((it) => it.videoId === videoId);

  if (index === -1) {
    // This post isn't in the resolved slice — either it doesn't match whatever filter
    // rode along on the URL, or the install has passed FEED_ORDER_LIMIT posts. Either
    // way, a made-up position is worse than none: no index label, no adjacency.
    return { backHref: `/feed${suffix}`, prevHref: null, nextHref: null, indexLabel: null };
  }

  return {
    backHref: `/feed${suffix}`,
    prevHref: index > 0 ? hrefFor(items[index - 1].videoId) : null,
    nextHref: index < items.length - 1 ? hrefFor(items[index + 1].videoId) : null,
    indexLabel: `${index + 1} of ${items.length}`,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ videoId: string }>;
}): Promise<Metadata> {
  const { videoId } = await params;
  const detail = await getCachedVideoDetail(videoId);
  // Calling notFound() here too (not just in the page body below) is still correct
  // regardless of the status-code caveat noted there: without it, a missing video
  // would silently fall through to a generic "Video · Crowsnest" title instead of
  // Next's proper not-found metadata.
  if (!detail) notFound();
  return { title: `${detail.item.caption?.slice(0, 40) ?? "Video"} · Crowsnest` };
}

// Topbar already renders this route's h1 ("Video Detail") — no duplicate heading (M6).
//
// KNOWN GAP: unlike /channels/[channelId] (identical notFound() pattern, no
// generateMetadata), a missing video here renders correct not-found *content* but
// the HTTP status stays 200, in both `next dev` and a production `next build && next
// start`. Confirmed the only difference between the two routes is this route's
// generateMetadata export — calling notFound() from generateMetadata too (above)
// fixes the metadata fallback but does NOT fix the status code, so the cause is some
// deeper interaction between generateMetadata and notFound()'s status-committing in
// this Next version, not a missing notFound() call. Didn't chase it further: fixing
// it would mean either dropping generateMetadata (which Task 7 explicitly requires)
// or restructuring how the shell streams, well beyond this task's file zone. Content
// correctness (users see a real not-found page) is intact; only the header is wrong.
export default async function VideoDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ videoId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { videoId } = await params;
  const sp = await searchParams;
  const detail = await getCachedVideoDetail(videoId);
  if (!detail) notFound();
  const [similar, transcriptProviders, medianBasis, feedNav, savedPost] = await Promise.all([
    getSimilarOutliers(videoId),
    availableTranscriptProviders(),
    getChannelMedianBasis(detail.item.channel.id, videoId),
    resolveFeedNav(videoId, sp),
    getSavedPostByVideoId(videoId),
  ]);
  const canTranscribe = transcriptProviders.some((p) => p.available);
  // Fire-and-forget (Task 1, phase 4): never await this — a slow/failing visit-track
  // write must not delay rendering the page itself. Errors are already swallowed
  // inside recordRecentlyViewed.
  void recordRecentlyViewed(videoId);

  return (
    <div className="mx-auto h-full max-w-[1120px]">
      <VideoDetail
        detail={detail}
        hasLlmKey={hasLlmKey()}
        canTranscribe={canTranscribe}
        similar={similar}
        medianBasis={medianBasis}
        feedNav={feedNav}
        savedPost={savedPost}
      />
    </div>
  );
}
