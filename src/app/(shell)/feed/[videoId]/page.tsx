import { cache, Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SimilarSection, SimilarSkeleton } from "@/components/video/similar-section";
import { VideoDetail } from "@/components/video/video-detail";
import type { SearchParams } from "@/lib/feed-filters";
import { hasLlmKey } from "@/server/llm/client";
import { getChannelMedianBasis } from "@/server/queries/channels";
import { getSavedPostByVideoId } from "@/server/queries/saved-posts";
import { getVideoDetail, recordRecentlyViewed } from "@/server/queries/video";
import { availableTranscriptProviders } from "@/server/transcribe";
import { resolveFeedNav } from "./resolve-feed-nav";

// Both generateMetadata and the page component need the same fetch this request —
// React's cache() dedupes them to a single DB round-trip.
const getCachedVideoDetail = cache(getVideoDetail);

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
// FIXED (B-14, 2026-09-02): a missing video used to render correct not-found content
// but stay on HTTP 200. Root cause was `../loading.tsx` (formerly a sibling at the
// `/feed` segment): its implicit ancestor Suspense boundary covered this nested
// `/feed/[videoId]` route too, and since this page's DB read is genuinely async, it
// always suspended into that boundary, which flushed (and committed 200) before this
// notFound() throw could run. Fix: the feed list route + its loading.tsx moved into
// `/feed/(list)/` (route group, no URL change), so the loading boundary no longer wraps
// this sibling segment.
//
// FIXED AGAIN (B-17, 2026-09-04): the B-14 fix missed a HIGHER ancestor. The generic
// shell skeleton lived at `(shell)/loading.tsx`, an ancestor Suspense boundary that
// still wrapped this route, so a missing video kept returning 200. Fix: the generic
// loading and every non-feed route moved into a `(shell)/(loaded)/` route group (no URL
// change), leaving `/feed` outside it. There is now NO loading boundary above
// `/feed/[videoId]`, so `notFound()` here produces a real 404, verified in a production
// build. Do not add a `loading.tsx` at `(shell)` root or under `/feed` above this route,
// and do not move `/feed` into `(loaded)` — either re-introduces the 200.
//
// B-14 STAYS SACRED (Task 4, Wave 3): `getCachedVideoDetail` + `notFound()` below are
// still the very first awaited work in this component, unchanged, and there is still no
// route `loading.tsx` here. The `<Suspense>` further down is an IN-PAGE boundary added
// only after that notFound() check has already had the chance to throw — it can never
// race ahead of it, so a bad videoId still 404s exactly as before.
//
// Task 4: getSimilarOutliers was the slowest of the five original Promise.all queries
// and, being a plain top-level await, blocked the whole page (and, unhandled, could
// blank it via the shell error boundary) on that one query. It now streams in behind
// its own Suspense boundary (SimilarSection, similar-section.tsx), which also
// try/catches it so a failure there degrades only that section. getChannelMedianBasis
// stays here, pre-awaited: unlike similar-outliers (a sibling section at the bottom of
// the page), it feeds MedianBaseline in the primary left column — required-visible,
// same synchronous tier as transcriptProviders/feedNav/savedPost.
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
  // A bare `/feed/[videoId]` visit (no forwarded filter) scopes prev/next against the
  // full raw library, the same default feed/page.tsx now shows on a bare `/feed` visit.
  const [transcriptProviders, medianBasis, feedNav, savedPost] = await Promise.all([
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
        medianBasis={medianBasis}
        feedNav={feedNav}
        savedPost={savedPost}
      >
        <Suspense fallback={<SimilarSkeleton />}>
          <SimilarSection videoId={videoId} />
        </Suspense>
      </VideoDetail>
    </div>
  );
}
