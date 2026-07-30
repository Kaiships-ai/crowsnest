"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { assetUrl } from "@/lib/media-url";
import { downloadVideoAction } from "@/server/actions/media-actions";

// "Hatching for a well with no data in it" (globals.css) — same tokened placeholder
// fill used by carousel-viewer.tsx's not-yet-downloaded slides, replacing the old
// bg-[#1E2230] hex that predates the token system.
const EMPTY_WELL: React.CSSProperties = {
  backgroundColor: "var(--hatch-1)",
  backgroundImage: "repeating-linear-gradient(135deg, var(--hatch-2) 0px, var(--hatch-2) 1px, transparent 1px, transparent 10px)",
};

/**
 * Download state machine for the "not downloaded yet" gate below. Modeled as one
 * tagged union (rather than a `pending` boolean plus a separate `error` string) so
 * "pending" and "has a stale error message" can never be true at the same time.
 */
type DownloadState = { kind: "idle" } | { kind: "pending" } | { kind: "error"; message: string };

/**
 * Renders a post's video, or an honest "not downloaded yet" gate when it isn't.
 *
 * Videos are fetched on demand (product decision, not a bug): most synced posts are
 * never watched, and eagerly downloading every video for a 30-day sync would be
 * gigabytes. So `videoAssetId === null` is the NORMAL state for a post nobody has
 * opened yet, not an error — it gets a real button, not a dead player.
 *
 * States this component renders, all real:
 *  1. `videoAssetId` present (either from props, or from a completed download this
 *     session) → a real `<video>` with the actual file and a real poster frame.
 *  2. No asset yet, idle → "Video not downloaded yet" + a Download button. This is
 *     the default for an unopened video, not framed as a failure.
 *  3. Download in flight → an indeterminate spinner + "Downloading video…". No fake
 *     progress percentage — the sidecar round-trip has no meaningful progress to
 *     report, so a spinner is the honest signal.
 *  4. Download failed → the real error message returned by the action, with the
 *     download button still present so the user can retry.
 */
export function VideoPlayer({
  videoId,
  videoAssetId,
  thumbnailAssetId,
}: {
  videoId: string;
  videoAssetId: string | null;
  thumbnailAssetId: string | null;
}) {
  const router = useRouter();
  // Set only on a successful download this session — lets the video render
  // immediately without waiting on the server-component refresh below to land.
  const [downloadedAssetId, setDownloadedAssetId] = useState<string | null>(null);
  const [state, setState] = useState<DownloadState>({ kind: "idle" });

  const resolvedAssetId = videoAssetId ?? downloadedAssetId;
  const src = assetUrl(resolvedAssetId);
  const poster = assetUrl(thumbnailAssetId);

  if (src) {
    return (
      <video
        controls
        preload="metadata"
        playsInline
        src={src}
        poster={poster ?? undefined}
        className="h-full w-full bg-black object-contain"
      >
        Your browser does not support embedded video.
      </video>
    );
  }

  async function download() {
    setState({ kind: "pending" });
    const result = await downloadVideoAction(videoId);
    if (result.ok) {
      setDownloadedAssetId(result.assetId);
      setState({ kind: "idle" });
      // Syncs the server-rendered detail (transcript/analysis panels etc. keyed off
      // the same video) with the now-persisted videoAssetId — the local state above
      // is what makes the player itself not have to wait on this round-trip.
      router.refresh();
    } else {
      setState({ kind: "error", message: result.error });
    }
  }

  const pending = state.kind === "pending";

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center" style={EMPTY_WELL}>
      {pending ? (
        <>
          <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">Downloading video…</p>
        </>
      ) : (
        <>
          <Play className="size-8 text-faint" fill="currentColor" aria-hidden />
          <p className="text-sm text-muted-foreground">Video not downloaded yet</p>
          <Button type="button" variant="outline" size="sm" onClick={download}>
            Download video
          </Button>
          {state.kind === "error" && (
            <p role="alert" className="max-w-[28ch] text-xs text-destructive">
              {state.message}
            </p>
          )}
        </>
      )}
    </div>
  );
}
