"use client";

import { Bar, BarChart, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { scalePosition } from "@/components/video/median-baseline";
import { formatMultiplier } from "@/lib/format";
import { type buildOutlierTimeline, TIMELINE_WINDOW_DAYS } from "./dashboard-chart-data";

const CHART_CONFIG: ChartConfig = {
  height: { label: "Best score", color: "var(--chart-1)" },
};

/**
 * "28-day rolling timeline" (v1-scope.md P1 list). v1-scope.md's own cut ruling on this
 * chart names the reason its per-day color ramp was cut: "a day's bucket has no single
 * score, so a tier colour asserts a reading the data does not contain." That argument is
 * about COLOR, not height, so every bar renders in one hue and only its height varies.
 *
 * Height is `scalePosition(bestScore)`, the same 0.2x to 12x log mapping the video
 * detail median bar and the reach/score scatter use, imported rather than re-derived so
 * the three screens cannot quietly disagree about what the scale means. That is also why
 * the y-axis is a fixed 0..1 domain and stays hidden: the number it would print is a
 * position on that scale, not a score, and labelling it would invite the wrong read. The
 * real score reaches the reader through the tooltip.
 */
export function OutlierTimeline({ days, hitDays }: ReturnType<typeof buildOutlierTimeline>) {
  const hasAny = days.some((d) => d.bestScore !== null);

  // A day with no post keeps a hairline bar rather than disappearing: the window is a
  // fixed 28 columns, and a missing column would read as a narrower window.
  const data = days.map((day) => ({
    index: day.index,
    height: day.bestScore !== null ? Math.max(0.04, scalePosition(day.bestScore)) : 0.01,
    bestScore: day.bestScore,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Last {TIMELINE_WINDOW_DAYS} days · rolling window</CardTitle>
      </CardHeader>
      <CardContent>
        {hasAny ? (
          <>
            <ChartContainer
              config={CHART_CONFIG}
              className="aspect-auto h-[100px] w-full"
              role="img"
              aria-label={`Column chart, the last ${TIMELINE_WINDOW_DAYS} days. ${hitDays} days produced a post that beat its channel.`}
            >
              <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
                <XAxis dataKey="index" hide />
                <YAxis domain={[0, 1]} hide />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      hideLabel
                      hideIndicator
                      formatter={(_value, _name, item) =>
                        item.payload.bestScore === null
                          ? "No post that day"
                          : `Best that day: ${formatMultiplier(item.payload.bestScore)}`
                      }
                    />
                  }
                />
                <Bar dataKey="height" fill="var(--color-height)" radius={2} isAnimationActive={false} />
              </BarChart>
            </ChartContainer>
            <div className="mt-5 flex flex-wrap justify-between gap-2 font-mono text-2xs tracking-wide text-muted-foreground">
              <span>{TIMELINE_WINDOW_DAYS - 1}d ago</span>
              <span data-num>{hitDays} days produced a post that beat its channel</span>
              <span>today</span>
            </div>
          </>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No scored post fell in the last {TIMELINE_WINDOW_DAYS} days.</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}
