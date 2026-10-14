"use client";

/**
 * "Metrics" view (v1-scope.md §1: the third of the three my-channel views, alongside
 * the calendar and the post list). Average reach by weekday, same shape as the tracked-
 * channel calendar's rhythm tab (`channel-post-calendar.tsx`) but built on Insights
 * reach rather than a view count, and carrying its sample size per weekday like every
 * other own-channel figure on this screen.
 */

import { Bar, BarChart, LabelList, Rectangle, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import type { OwnPostRow } from "@/server/queries/own-channel";

const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

const CHART_CONFIG: ChartConfig = {
  avgValue: { label: "Average reach", color: "var(--muted-foreground)" },
};

export function OwnWeekdayRhythm({ posts }: { posts: OwnPostRow[] }) {
  const measured = posts.filter((p) => p.reach !== null);

  const buckets = WEEKDAY_LABELS.map(() => ({ total: 0, n: 0 }));
  for (const p of measured) {
    const jsDay = new Date(p.postedAt).getUTCDay(); // 0=Sun
    const idx = (jsDay + 6) % 7; // 0=Mon
    buckets[idx].total += p.reach as number;
    buckets[idx].n += 1;
  }

  const rhythm = buckets.map((b, i) => {
    const avg = b.n > 0 ? Math.round(b.total / b.n) : null;
    return {
      label: WEEKDAY_LABELS[i],
      avg,
      // The bar plots 0 for a weekday nobody posted on, so the column still exists and
      // its label still renders. The label is what carries the distinction: a dash
      // means "no measured post", a printed 0 would mean "measured, and it was zero".
      avgValue: avg ?? 0,
      avgLabel: avg === null ? "—" : avg.toLocaleString("en-US"),
      n: b.n,
    };
  });

  if (measured.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No measured posts yet to read a weekday rhythm from.</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Average reach by weekday</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={CHART_CONFIG} className="aspect-auto h-[180px] w-full">
          <BarChart data={rhythm} margin={{ top: 20, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tickLine={false} axisLine={false} className="font-mono" />
            <YAxis hide />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(_value, _name, item) =>
                    item.payload.avg === null
                      ? "No measured post"
                      : `${item.payload.avg.toLocaleString("en-US")} average reach, n=${item.payload.n}`
                  }
                />
              }
            />
            {/* The value rides above its own bar rather than in a y-axis, because with
                seven buckets and a handful of posts the exact number is the point and
                an axis scale would imply more precision than the sample carries. */}
            {/* minPointSize keeps a weekday nobody posted on as a 2px stub rather than
                nothing, which is what the hand-drawn version did and what makes its
                dash label render at all. */}
            <Bar
              dataKey="avgValue"
              fill="var(--color-avgValue)"
              fillOpacity={0.4}
              radius={2}
              minPointSize={2}
              isAnimationActive={false}
              shape={(props: React.ComponentProps<typeof Rectangle>) => (
                <g data-testid="mine-weekday-bar">
                  <Rectangle {...props} />
                </g>
              )}
            >
              <LabelList dataKey="avgLabel" position="top" className="fill-muted-foreground font-mono text-xs" />
            </Bar>
          </BarChart>
        </ChartContainer>
        <p className="mt-7 max-w-[60ch] text-sm text-muted-foreground">
          Every bar is an average across {measured.length} measured post{measured.length === 1 ? "" : "s"} total,
          spread over seven buckets, and most days here carry one post or none. Read this as a reading, not a
          rhythm, until each weekday carries more than a couple.
        </p>
      </CardContent>
    </Card>
  );
}
