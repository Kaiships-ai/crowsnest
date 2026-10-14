"use client";

import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, XAxis, YAxis } from "recharts";

import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatCompact, formatMultiplier, relativeTime } from "@/lib/format";
import { heatTier, type HeatTier } from "@/lib/heat";
import type { ChannelDetail } from "@/server/queries/channels";

type SeriesPoint = ChannelDetail["series"][number];

/** The score a point has to clear before it is worth picking out of the trend line. */
const DOT_THRESHOLD = 2;

// The heat ramp, as dot fills for the points that cleared DOT_THRESHOLD. Tier 4 has no
// flat colour of its own (the badge draws it as a gradient), so here it takes the hot
// end of the theme ramp rather than carrying a gradient def into a chart library.
const DOT_FILL: Record<Exclude<HeatTier, 0>, string> = {
  1: "var(--chart-3)",
  2: "var(--chart-2)",
  3: "var(--chart-2)",
  4: "var(--chart-1)",
};

const CHART_CONFIG: ChartConfig = {
  viewCount: { label: "Views", color: "var(--muted-foreground)" },
};

/**
 * Channel detail's outlier-history chart: one muted line for the full view-count trend,
 * with the points that cleared the outlier threshold picked out as tier-coloured dots.
 *
 * Those dots are a custom `dot` renderer on the one Line rather than a second series,
 * because a second series over the same x-axis would give the tooltip two rows for what
 * the reader sees as one point.
 */
export function OutlierHistoryChart({ series }: { series: ChannelDetail["series"] }) {
  const points = [...series]
    .filter((p): p is SeriesPoint & { viewCount: number } => p.viewCount !== null)
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">Not enough data yet to chart a trend.</p>;
  }

  return (
    <Card>
      <CardContent>
        <ChartContainer
          config={CHART_CONFIG}
          className="aspect-auto h-[200px] w-full"
          role="img"
          aria-label="Outlier history: view count over time"
        >
          <LineChart data={points} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="capturedAt"
              tickFormatter={(v: string) => relativeTime(v)}
              tickLine={false}
              axisLine={false}
              minTickGap={32}
              className="font-mono"
            />
            <YAxis
              dataKey="viewCount"
              tickFormatter={(v: number) => formatCompact(v)}
              tickLine={false}
              axisLine={false}
              width={48}
              className="font-mono"
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  hideLabel
                  formatter={(_value, _name, item) =>
                    `${relativeTime(item.payload.capturedAt)} · ${formatCompact(item.payload.viewCount)} views · ${formatMultiplier(item.payload.outlierScore)}`
                  }
                />
              }
            />
            <Line
              type="monotone"
              dataKey="viewCount"
              stroke="var(--color-viewCount)"
              strokeWidth={2}
              isAnimationActive={false}
              activeDot={{ r: 5 }}
              dot={(props) => {
                const { cx, cy, key, payload } = props as { cx: number; cy: number; key: string; payload: SeriesPoint };
                const score = payload.outlierScore;
                if (score === null || score < DOT_THRESHOLD) return <g key={key} />;
                const tier = heatTier(score) as Exclude<HeatTier, 0>;
                return <circle key={key} cx={cx} cy={cy} r={5} fill={DOT_FILL[tier]} stroke="var(--card)" strokeWidth={2} />;
              }}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

const VIEW_BAR_COUNT = 8;

/**
 * "Views by post" bars, scoped to the last `VIEW_BAR_COUNT` measured posts, oldest to
 * newest left-to-right so the read direction matches the calendar and post list below.
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
 * Bars stay a neutral fill on purpose: the chart ramp marks a score, a ratio against a
 * baseline, and a raw view count is not that.
 */
type VideoItem = ChannelDetail["videos"][number];

const VIEWS_CHART_CONFIG: ChartConfig = {
  viewCount: { label: "Views", color: "var(--muted-foreground)" },
};

export function ViewsByPostBars({ videos }: { videos: ChannelDetail["videos"] }) {
  const measured = videos.filter((v): v is VideoItem & { viewCount: number } => v.viewCount !== null);
  // `viewLabel` is precomputed because Recharts' label formatter type takes no null and
  // this printed numeral is the point of the chart, not a tooltip-only detail.
  const posts = measured
    .slice(0, VIEW_BAR_COUNT)
    .slice()
    .reverse()
    .map((p) => ({ ...p, viewLabel: formatCompact(p.viewCount) }));

  if (posts.length === 0) {
    return <p className="text-sm text-muted-foreground">No measured posts yet.</p>;
  }

  return (
    <div>
      <span data-lab className="font-mono text-2xs text-muted-foreground">
        Views by post · last {posts.length} post{posts.length === 1 ? "" : "s"}, rolling
      </span>
      <ChartContainer config={VIEWS_CHART_CONFIG} className="mt-6 aspect-auto h-[150px] w-full">
        <BarChart data={posts} margin={{ top: 16, right: 0, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="postedAt"
            tickFormatter={(v: string) => relativeTime(v)}
            tickLine={false}
            axisLine={false}
            minTickGap={16}
            className="font-mono"
          />
          <YAxis hide />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(_value, _name, item) =>
                  `${formatCompact(item.payload.viewCount)} views · ${relativeTime(item.payload.postedAt)}`
                }
              />
            }
          />
          <Bar dataKey="viewCount" fill="var(--color-viewCount)" fillOpacity={0.4} radius={2} isAnimationActive={false}>
            <LabelList dataKey="viewLabel" position="top" className="fill-foreground font-mono text-xs" />
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}
