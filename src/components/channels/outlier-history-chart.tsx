"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCompact, formatMultiplier, relativeTime } from "@/lib/format";
import { heatTier, type HeatTier } from "@/lib/heat";
import type { ChannelDetail } from "@/server/queries/channels";

type SeriesPoint = ChannelDetail["series"][number];

const WIDTH_PER_POINT = 44;
const MIN_WIDTH = 560;
const HEIGHT = 200;
const PAD_X = 24;
const PAD_TOP = 28;
const PAD_BOTTOM = 24;
const GRIDLINES = 4;

// DESIGN.md §5 heat ramp — dot fills for outlier-threshold points (tier 4 uses the
// same 135deg gradient as the badge, via the <defs> below).
const DOT_FILL: Record<Exclude<HeatTier, 0>, string> = {
  1: "#C98A4A",
  2: "#F5A524",
  3: "#F5A524",
  4: "url(#outlier-chart-tier4)",
};

/**
 * Channel Detail's outlier-history chart, DESIGN.md §5 "emphasis" dataviz form: one
 * muted line for the full view-count trend, outlier-threshold points picked out as
 * tier-colored dots, one direct label on the single highest spike. Deliberately no
 * chart lib and no mouse-following crosshair (a Tooltip anchored per-point covers the
 * "hover -> date/views/multiplier" requirement without hand-rolling pointer tracking) —
 * kept close to the plan's ~120-line budget for this component.
 */
export function OutlierHistoryChart({ series }: { series: ChannelDetail["series"] }) {
  const points = [...series]
    .filter((p): p is SeriesPoint & { viewCount: number } => p.viewCount !== null)
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">Not enough data yet to chart a trend.</p>;
  }

  const width = Math.max(MIN_WIDTH, points.length * WIDTH_PER_POINT);
  const times = points.map((p) => new Date(p.capturedAt).getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const maxView = Math.max(...points.map((p) => p.viewCount));

  const xFor = (t: number) =>
    PAD_X + (maxTime === minTime ? 0 : ((t - minTime) / (maxTime - minTime)) * (width - PAD_X * 2));
  const yFor = (v: number) =>
    HEIGHT - PAD_BOTTOM - (v / (maxView || 1)) * (HEIGHT - PAD_TOP - PAD_BOTTOM);

  const coords = points.map((p, i) => ({ point: p, x: xFor(times[i]), y: yFor(p.viewCount) }));
  const linePath = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const outlierCoords = coords.filter((c) => c.point.outlierScore !== null && c.point.outlierScore >= 2);
  const peak = coords.reduce((max, c) => (c.point.viewCount > max.point.viewCount ? c : max), coords[0]);

  return (
    <div className="overflow-x-auto border border-border bg-card p-4">
      <svg width={width} height={HEIGHT} role="img" aria-label="Outlier history: view count over time">
        <defs>
          <linearGradient id="outlier-chart-tier4" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FF7A1A" />
            <stop offset="100%" stopColor="#FF3D3D" />
          </linearGradient>
        </defs>

        {Array.from({ length: GRIDLINES }).map((_, i) => {
          const y = PAD_TOP + (i * (HEIGHT - PAD_TOP - PAD_BOTTOM)) / (GRIDLINES - 1);
          return <line key={i} x1={PAD_X} x2={width - PAD_X} y1={y} y2={y} className="stroke-border" strokeWidth={1} />;
        })}

        <polyline points={linePath} fill="none" className="stroke-muted-foreground" strokeWidth={2} />

        {coords.map((c) => (
          <Tooltip key={c.point.videoId}>
            <TooltipTrigger
              render={<circle cx={c.x} cy={c.y} r={8} fill="transparent" className="cursor-pointer" />}
            />
            <TooltipContent>
              {relativeTime(c.point.capturedAt)} · {formatCompact(c.point.viewCount)} views ·{" "}
              {formatMultiplier(c.point.outlierScore)}
            </TooltipContent>
          </Tooltip>
        ))}

        {outlierCoords.map((c) => {
          const tier = heatTier(c.point.outlierScore) as Exclude<HeatTier, 0>;
          return (
            <circle
              key={`dot-${c.point.videoId}`}
              cx={c.x}
              cy={c.y}
              r={5}
              fill={DOT_FILL[tier]}
              className="stroke-card"
              strokeWidth={2}
              pointerEvents="none"
            />
          );
        })}

        <text
          x={peak.x}
          y={Math.max(12, peak.y - 12)}
          textAnchor="middle"
          className="fill-foreground text-[11px] font-medium"
        >
          {formatMultiplier(peak.point.outlierScore)}
        </text>
      </svg>
    </div>
  );
}

const VIEW_BAR_COUNT = 8;

/**
 * "Views by post" bars (mine.html's `mineBars`), scoped to the last `VIEW_BAR_COUNT`
 * measured posts, oldest to newest left-to-right so the read direction matches the
 * calendar and post list below it.
 *
 * Named for what it plots. Every value here is `videos.view_count`, a public number this
 * app can read for any tracked channel. Reach is a different metric that exists only for
 * an owned channel, comes from Instagram Insights, and is plotted by `ReachByPostBars` in
 * components/mine/reach-by-post-bars.tsx. This component was called `ReachByPostBars` too
 * until M5, which read as a duplicate of that one and as a view count relabeled as reach,
 * the exact conflation the mine component's own header forbids. The two look similar and
 * are not interchangeable: they differ in metric, data shape, how many posts they show,
 * and what they do with a post that has no measurement.
 *
 * Bars stay a neutral fill on purpose: amber is reserved for the score (a baseline
 * ratio), and a raw view count is not that — see DESIGN.md's amber budget.
 */
type VideoItem = ChannelDetail["videos"][number];

export function ViewsByPostBars({ videos }: { videos: ChannelDetail["videos"] }) {
  const measured = videos.filter((v): v is VideoItem & { viewCount: number } => v.viewCount !== null);
  const posts = measured.slice(0, VIEW_BAR_COUNT).slice().reverse();

  if (posts.length === 0) {
    return <p className="text-sm text-muted-foreground">No measured posts yet.</p>;
  }

  const max = Math.max(...posts.map((p) => p.viewCount), 1);

  return (
    <div>
      <span data-lab className="font-mono text-2xs text-faint">
        Views by post · last {posts.length} post{posts.length === 1 ? "" : "s"}, rolling
      </span>
      <div className="mt-6 flex h-[150px] items-end gap-3.5">
        {posts.map((p) => (
          <div key={p.videoId} className="flex h-full flex-1 flex-col justify-end gap-2.5" title={relativeTime(p.postedAt)}>
            <span data-num className="font-mono text-xs">
              {formatCompact(p.viewCount)}
            </span>
            <div className="bg-muted-foreground/40" style={{ height: `${Math.max(4, (p.viewCount / max) * 100)}%` }} />
            <span className="font-mono text-2xs text-faint">{relativeTime(p.postedAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
