import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { VideoDetail } from "@/components/video/video-detail";
import { getVideoDetail } from "@/server/queries/video";

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
export default async function VideoDetailPage({ params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;
  const detail = await getCachedVideoDetail(videoId);
  if (!detail) notFound();

  return (
    <div className="mx-auto h-full max-w-[1120px]">
      <VideoDetail detail={detail} />
    </div>
  );
}
