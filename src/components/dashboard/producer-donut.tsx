"use client";

import Link from "next/link";
import { Cell, Pie, PieChart } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import type { FeedItem } from "@/server/queries/feed";
import { buildProducerDonut } from "./dashboard-chart-data";

// Categorical, not a magnitude ramp: these four tell channels apart, they do not grade
// "which is more", which a producer's identity does not carry. The `--chart-1..5` tokens
// are the theme's one named categorical palette, so the next chart that needs to
// distinguish series has something to reach for by name.
const SLICE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

/**
 * "Who produces them" (v1-scope.md P1 list): share of the posts that beat their own
 * channel, by channel. Only channels that actually have at least one such post get a
 * slice — a channel that's never synced can't produce one, so it never fabricates a
 * zero-width sliver for itself.
 *
 * `buildProducerDonut` owns the folding of the long tail into one "Other" slice and the
 * percentage math; this file only draws what it returns.
 */
export function ProducerDonut({ items }: { items: FeedItem[] }) {
  const { slices, outlierTotal, postTotal } = buildProducerDonut(items);

  if (outlierTotal === 0) {
    return (
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Who produces them</CardTitle>
        </CardHeader>
        <CardContent>
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No post has beaten its own channel yet, so there is nothing to attribute.</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  const arcs = slices.map((slice, i) => ({ ...slice, color: SLICE_COLORS[i % SLICE_COLORS.length] }));
  const top = arcs[0];

  // Keyed by handle because that is what Recharts passes the tooltip as `name`. The
  // folded "Other" slice is a real key here too, so it gets a label like any channel.
  const config: ChartConfig = Object.fromEntries(
    arcs.map((arc) => [arc.handle, { label: arc.handle, color: arc.color }]),
  );

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Who produces them</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-6 sm:flex-row sm:gap-10">
        <ChartContainer
          config={config}
          className="aspect-square h-[168px] w-[168px] shrink-0"
          role="img"
          aria-label={`Donut chart, share of posts that beat their channel, by channel. ${top.handle} produced ${top.pct}%.`}
        >
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="handle" hideLabel />} />
            <Pie data={arcs} dataKey="count" nameKey="handle" innerRadius="62%" outerRadius="100%" paddingAngle={2}>
              {arcs.map((arc) => (
                <Cell key={arc.channelId || "other"} fill={arc.color} stroke="none" />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>

        <div className="flex min-w-0 flex-col gap-3">
          {/* The folded "Other" slice has no channelId — it stands for several channels,
              so it gets no link. Every other row still goes to its channel. */}
          {arcs.map((arc) =>
            arc.channelId ? (
              <Link key={arc.channelId} href={`/channels/${arc.channelId}`} className="flex items-center gap-3 hover:underline">
                <span aria-hidden className="size-2 shrink-0" style={{ background: arc.color }} />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground sm:min-w-[160px]">{arc.handle}</span>
                <span data-num className="font-mono text-sm text-muted-foreground">
                  {arc.count}
                </span>
              </Link>
            ) : (
              <div key="other" className="flex items-center gap-3">
                <span aria-hidden className="size-2 shrink-0" style={{ background: arc.color }} />
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground sm:min-w-[160px]">{arc.handle}</span>
                <span data-num className="font-mono text-sm text-muted-foreground">
                  {arc.count}
                </span>
              </div>
            ),
          )}
        </div>
      </CardContent>
      <CardContent>
        <p className="max-w-[52ch] text-sm text-muted-foreground">
          Share of the <span data-num>{outlierTotal}</span> post{outlierTotal === 1 ? "" : "s"} that beat their channel, not of
          all <span data-num>{postTotal}</span> synced · <span data-num>{top.pct}%</span> came from {top.handle}
        </p>
      </CardContent>
    </Card>
  );
}
