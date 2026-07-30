import { medianConfidence, type BaselineMethod, type WindowSpec } from "@/server/services/outlier-calc";
import type { MedianBasis } from "@/server/queries/channels";
import { formatCompact, formatMultiplier } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The video detail screen's "explain the score" block (V1 scope §2, Video detail
 * criteria 3-7; gap inventory's #4 hole: no median bar, no sample sparkline, no
 * confidence, no sample size). Everything here reads off `getChannelMedianBasis` — the
 * same sample the score itself was computed from — so the bar, the histogram, and the
 * hero number can never quietly disagree about what "normal" means for this channel.
 */

// The scale the median bar and its 1.0x tick are drawn on: 0.2x to 12x. Log, not
// linear, because a 40x outlier and a 0.3x post both need to be readable on the same
// bar — a linear scale would flatten everything below 2x into a sliver. Matches the
// prototype's bar geometry (proto/detail.html): position(1.0x) works out to ~39.3%,
// the same number the prototype hardcoded for its static demo data.
const SCALE_MIN = 0.2;
const SCALE_MAX = 12;

/** Where a multiplier sits on the 0.2x-12x log scale, as a 0..1 fraction. Clamped at
 *  both ends — a 60x post still reads as "off the right edge", not an overflowing bar. */
export function scalePosition(x: number): number {
  const clamped = Math.min(Math.max(x, SCALE_MIN), SCALE_MAX);
  return Math.log(clamped / SCALE_MIN) / Math.log(SCALE_MAX / SCALE_MIN);
}

/** "median" | "mean" | "trimmedMean" -> the word that belongs in "vs @handle's own
 *  ___". Exported so the copy can't drift between this file and a future caller. */
export function methodLabel(method: BaselineMethod): string {
  if (method === "mean") return "mean";
  if (method === "trimmedMean") return "trimmed mean";
  return "median";
}

/** A `WindowSpec` -> the phrase that belongs after "over". */
export function windowLabel(window: WindowSpec): string {
  if (window.kind === "posts") return `its last ${window.count} posts`;
  if (window.kind === "days") return `the last ${window.count} days`;
  return "all of its history";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Intl-free, deterministic, matching lib/format.ts's own constraint on itself — kept
 *  local rather than added to that shared file, which this slice doesn't own. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

const CONFIDENCE_COPY: Record<ReturnType<typeof medianConfidence>, { word: string; className: string }> = {
  low: { word: "Low confidence", className: "text-faint" },
  medium: { word: "Medium confidence", className: "text-muted-foreground" },
  high: { word: "High confidence", className: "text-pos" },
};

export function MedianBaseline({
  score,
  handle,
  basis,
}: {
  /** The video's own outlier score — `videos.outlier_score`, one decimal. */
  score: number | null;
  handle: string;
  /** Null only if the channel row itself vanished between the feed query and this
   *  render (deleted mid-session) — genuinely rare, handled as its own dash state
   *  rather than crashing the page (Global acceptance #1/#2). */
  basis: MedianBasis | null;
}) {
  // Score is the hero everywhere it appears; amber means exactly one thing — this post
  // beat its channel's baseline, i.e. score >= 1.0. Not the feed badge's 2x/5x/10x heat
  // tiers, which color a pill for scanning a grid, not for asserting "beat or didn't".
  const beatBaseline = score !== null && score >= 1;

  return (
    <div className="flex flex-col gap-3">
      <span data-num className={cn("block font-mono text-[52px] leading-none font-medium tracking-tight", beatBaseline ? "text-score" : "text-foreground")}>
        {formatMultiplier(score)}
      </span>

      {!basis ? (
        <p className="text-sm text-muted-foreground">No channel data to measure this against.</p>
      ) : basis.median === null ? (
        // Below scoreMinUsablePosts: a real sample size, no fabricated baseline. Per
        // acceptance criterion 6 — say how many posts exist and how many are needed,
        // never a fake zero and never hide the section.
        <div className="max-w-[52ch]">
          <p className="text-sm text-muted-foreground">
            Not enough of {handle}&rsquo;s posts yet to have a normal.{" "}
            <span data-num>{basis.sampleSize}</span> of <span data-num>{basis.minUsable}</span> needed before a{" "}
            {methodLabel(basis.method)} means anything.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            above {handle}&rsquo;s own {methodLabel(basis.method)} · over {windowLabel(basis.window)}
          </p>

          <div className="mt-2 max-w-[32rem]">
            <div className="relative h-1.5 bg-secondary">
              <span
                className={cn("absolute top-0 left-0 h-1.5", beatBaseline ? "bg-score" : "bg-line-strong")}
                style={{ width: `${(score !== null ? scalePosition(score) : 0) * 100}%` }}
              />
              <span
                aria-hidden
                className="absolute top-[-5px] h-4 w-px bg-line-strong"
                style={{ left: `${scalePosition(1) * 100}%` }}
              />
            </div>
            <div className="mt-2.5 flex justify-between font-mono text-2xs tracking-wide text-faint">
              <span>0.2×</span>
              <span data-num className="text-muted-foreground">
                1.0× = {formatCompact(basis.median)}
              </span>
              <span>12×</span>
            </div>

            <ChannelHistogram basis={basis} />
          </div>
        </>
      )}
    </div>
  );
}

function ChannelHistogram({ basis }: { basis: MedianBasis }) {
  const conf = CONFIDENCE_COPY[medianConfidence(basis.sampleSize)];
  const maxViews = Math.max(1, ...basis.bars.map((b) => b.viewCount));
  const selfBar = basis.bars.find((b) => b.isSelf);

  return (
    <div className="mt-8">
      <span data-lab className="font-mono text-2xs text-faint">
        What that {methodLabel(basis.method)} is made of · {basis.handle}
      </span>

      {basis.bars.length > 0 ? (
        <div
          role="img"
          aria-label={`${basis.sampleSize} posts sampled for ${basis.handle}'s baseline, ${conf.word.toLowerCase()}`}
          className="relative mt-5 flex h-[72px] items-end gap-1"
        >
          <span aria-hidden className="absolute right-0 bottom-9 left-0 h-px bg-line-strong" />
          {basis.bars.map((bar) => (
            <span
              key={bar.videoId}
              title={`${shortDate(bar.postedAt)} · ${formatCompact(bar.viewCount)} views${bar.isSelf ? " · this post" : ""}`}
              className="relative flex h-full min-w-[3px] flex-1 items-end"
            >
              <span
                className={cn("w-full", bar.isSelf ? "bg-score" : "bg-line-strong")}
                style={{ height: `${Math.max(2, (bar.viewCount / maxViews) * 100)}%` }}
              />
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No posts in the current baseline window.</p>
      )}

      <div className="mt-2.5 flex justify-between gap-4 font-mono text-2xs tracking-wide text-faint">
        <span>
          {basis.spanFrom && basis.spanTo ? `${shortDate(basis.spanFrom)} – ${shortDate(basis.spanTo)}` : "—"}
          {" · "}
          <span data-num>{basis.sampleSize}</span> posts sampled
        </span>
        {selfBar && (
          <span className="text-score" data-num>
            this post · {formatCompact(selfBar.viewCount)}
          </span>
        )}
      </div>
      <div className={cn("mt-2 font-mono text-2xs tracking-wide", conf.className)}>{conf.word}</div>
      <p className="mt-3 max-w-[56ch] text-sm text-muted-foreground">
        {basis.handle}&rsquo;s {methodLabel(basis.method)} is the {methodLabel(basis.method)} view count across{" "}
        <span data-num>{basis.sampleSize}</span> posts, {windowLabel(basis.window)}.
      </p>
    </div>
  );
}
