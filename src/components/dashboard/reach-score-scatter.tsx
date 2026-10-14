"use client";

import { CartesianGrid, Cell, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { scalePosition } from "@/components/video/median-baseline";
import { formatCompact, formatMultiplier } from "@/lib/format";
import { type buildScatterPoints, viewScalePosition } from "./dashboard-chart-data";

const CHART_CONFIG: ChartConfig = {
  score: { label: "Score", color: "var(--chart-1)" },
};

// Both axes are 0..1 positions from the shared scale helpers, not raw values, so the
// ticks are labelled by hand with the value each position stands for. Recharts'
// `scale="log"` is deliberately not used: `viewScalePosition` and `scalePosition` are
// tested pure functions that the video detail median bar and the 28-day timeline also
// read, and letting the chart library derive its own log mapping would give this screen
// a second, silently different definition of the same scale.
const X_TICKS = [
  { pos: viewScalePosition(1_000), label: "1K" },
  { pos: viewScalePosition(100_000), label: "100K" },
  { pos: viewScalePosition(10_000_000), label: "10M" },
];
const Y_TICKS = [
  { pos: scalePosition(1), label: "1×" },
  { pos: scalePosition(12), label: "12×" },
];

/**
 * "Reach vs score" (v1-scope.md P1 list): every scored post, view count on a log x-axis
 * against its own score on the same 0.2x-12x log scale the video detail median bar uses.
 * Dot color is the binary "beat its channel or not" read: this dot's y-position already
 * IS the score, so colouring it off the score asserts nothing the data does not contain.
 */
export function ReachScoreScatter({ points, omitted }: ReturnType<typeof buildScatterPoints>) {

  if (points.length === 0) {
    return (
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Reach vs score</CardTitle>
        </CardHeader>
        <CardContent>
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No post has both a score and a view count yet, so there is nothing to plot.</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  const beatCount = points.filter((p) => p.beat).length;
  const data = points.map((p) => ({ ...p, x: viewScalePosition(p.viewCount), y: scalePosition(p.score) }));

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Reach vs score</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={CHART_CONFIG}
          className="aspect-auto h-[200px] w-full"
          role="img"
          aria-label={`Scatter plot, log reach against outlier score. ${points.length} posts; ${beatCount} beat their channel median.`}
        >
          <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, 1]}
              ticks={X_TICKS.map((t) => t.pos)}
              tickFormatter={(v: number) => X_TICKS.find((t) => t.pos === v)?.label ?? ""}
              tickLine={false}
              axisLine={false}
              className="font-mono"
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, 1]}
              ticks={Y_TICKS.map((t) => t.pos)}
              tickFormatter={(v: number) => Y_TICKS.find((t) => t.pos === v)?.label ?? ""}
              tickLine={false}
              axisLine={false}
              width={40}
              className="font-mono"
            />
            {/* The line a post has to clear to have beaten its own channel. */}
            <ReferenceLine y={scalePosition(1)} stroke="var(--border)" />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  hideLabel
                  formatter={(_value, _name, item) =>
                    `${item.payload.handle} · ${formatMultiplier(item.payload.score)} · ${formatCompact(item.payload.viewCount)} views`
                  }
                />
              }
            />
            <Scatter data={data} dataKey="y" isAnimationActive={false}>
              {data.map((p) => (
                <Cell
                  key={p.videoId}
                  r={p.beat ? 5 : 3.5}
                  fill={p.beat ? "var(--primary)" : "var(--muted-foreground)"}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ChartContainer>
        <p className="mt-5 max-w-[52ch] text-sm text-muted-foreground">
          <span data-num>{points.length}</span> post{points.length === 1 ? "" : "s"} plotted
          {omitted > 0 ? `, ${omitted} left out for missing a score or a view count` : ""} — reach on a log scale, score against
          each post&rsquo;s own channel median.
        </p>
      </CardContent>
    </Card>
  );
}
