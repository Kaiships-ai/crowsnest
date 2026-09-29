"use client";

/**
 * Reach by post (v1-scope.md §1 "My channel": "Reach by post bars — the core own-
 * channel read"). Every value is `OwnPostRow.reach`, straight from Instagram Insights —
 * never `videos.view_count`, never a view count relabeled as reach (CONTEXT.md:
 * "Insight: a metric that exists only for an Owned channel: reach, saves, shares...").
 *
 * Kai's own channel has ~5 followers and posts that reach ~9 people (WAVE2-BRIEF: "tiny
 * numbers need dignity... a reach of 9 must not look broken and must not be dressed up
 * as a trend"). Two rules follow from that:
 *   - every bar gets a visible floor, so a 9 next to a 400 is still a bar and not a
 *     sliver that reads as a rendering bug. That floor is the y-axis domain: the axis
 *     starts slightly below zero so the smallest real value still paints. It is never a
 *     log scale and never a value transform, and the numeral printed above each bar is
 *     always the real number, so nothing here makes 9 look bigger than it is;
 *   - a post with no measured reach gets no bar at all and is counted separately. A
 *     missing measurement drawn as a zero-height bar would be indistinguishable from a
 *     real, tiny reach of zero, so `null` stays `null` all the way into the chart.
 */

import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, relativeTime } from "@/lib/format";
import type { OwnPostRow } from "@/server/queries/own-channel";

const CHART_CONFIG: ChartConfig = {
  reachValue: { label: "Reach", color: "var(--muted-foreground)" },
};

export function ReachByPostBars({ posts }: { posts: OwnPostRow[] }) {
  if (posts.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No posts synced from Instagram yet.</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  // Oldest first, left to right — same reading order as the calendar below it.
  // A post with no measured reach plots 0, so its column still exists and its label
  // still renders. The label is what carries the distinction: a dash means "not
  // measured", a printed 0 would mean "measured, and it reached nobody".
  const chronological = [...posts].reverse().map((p) => ({
    ...p,
    reachValue: p.reach ?? 0,
    reachLabel: p.reach === null ? "—" : p.reach.toLocaleString("en-US"),
  }));
  const measured = chronological.filter((p) => p.reach !== null);
  const missing = chronological.length - measured.length;
  const maxReach = Math.max(1, ...measured.map((p) => p.reach as number));

  return (
    <Card data-testid="mine-reach-bars">
      <CardHeader>
        <CardTitle>
          Reach by post · all {chronological.length} post{chronological.length === 1 ? "" : "s"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={CHART_CONFIG}
          className="aspect-auto h-[150px] w-full"
          role="img"
          aria-label={`Reach for ${measured.length} of ${chronological.length} posts`}
        >
          <BarChart data={chronological} margin={{ top: 20, right: 0, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="postedAt"
              tickFormatter={(v: string) => relativeTime(v).replace(" ago", "")}
              tickLine={false}
              axisLine={false}
              minTickGap={8}
              className="font-mono"
            />
            {/* The visible floor: the domain reaches below zero so the smallest real
                reach still paints a bar instead of a hairline. */}
            <YAxis domain={[-maxReach * 0.06, maxReach]} hide />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  hideLabel
                  formatter={(_value, _name, item) =>
                    `${item.payload.reachLabel} reach · ${item.payload.caption ?? "Untitled post"}`
                  }
                />
              }
            />
            {/* minPointSize keeps an unmeasured post as a 2px stub rather than nothing,
                so its dash label still renders above the column it belongs to. */}
            <Bar
              dataKey="reachValue"
              fill="var(--color-reachValue)"
              radius={2}
              minPointSize={2}
              isAnimationActive={false}
            >
              <LabelList dataKey="reachLabel" position="top" className="fill-foreground font-mono text-sm" />
            </Bar>
          </BarChart>
        </ChartContainer>
        <p className="mt-5 max-w-[52ch] text-sm text-muted-foreground">
          {missing > 0
            ? `${measured.length} of ${chronological.length} posts have a measured reach. ${missing} ${missing === 1 ? "has" : "have"} none yet.`
            : `Every one of these ${chronological.length} posts has a measured reach.`}
        </p>
      </CardContent>
    </Card>
  );
}

/** Flat post list — title, reach, length, published (v1-scope.md §1: "Post list:
 *  title, reach, length, published"). Kept in the same file as the bars since both read
 *  the identical `OwnPostRow[]` and neither needs its own data shape. */
export function OwnPostList({ posts }: { posts: OwnPostRow[] }) {
  if (posts.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No posts synced from Instagram yet.</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }
  const maxReach = Math.max(1, ...posts.map((p) => p.reach ?? 0));

  return (
    <Table className="min-w-[720px]">
      <TableHeader>
        <TableRow>
          <TableHead>Post</TableHead>
          <TableHead className="w-[140px] text-right">Reach</TableHead>
          <TableHead className="w-[88px] text-right">Length</TableHead>
          <TableHead className="w-[110px] text-right">Published</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {posts.map((p) => (
          // The whole row is the link, same as before this row was a table: the anchor
          // lives in the first cell and stretches over the row, since an <a> may not wrap
          // a <tr>.
          <TableRow key={p.ownPostId} className="relative" data-testid="mine-post-row">
            <TableCell>
              <a
                href={p.permalink}
                target="_blank"
                rel="noreferrer"
                className="block truncate after:absolute after:inset-0"
              >
                {p.caption ?? "Untitled post"}
              </a>
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-3">
                <div className="h-1.5 flex-1 bg-popover">
                  <div
                    className="h-1.5 bg-muted-foreground"
                    style={{ width: p.reach === null ? 0 : `${Math.max(2, (p.reach / maxReach) * 100)}%` }}
                  />
                </div>
                <span data-num className="w-14 shrink-0 text-right font-mono text-sm">
                  {p.reach === null ? "—" : p.reach.toLocaleString("en-US")}
                </span>
              </div>
            </TableCell>
            <TableCell data-num className="text-right font-mono text-2xs text-muted-foreground">
              {p.durationSec === null ? "—" : formatDuration(p.durationSec)}
            </TableCell>
            <TableCell className="text-right font-mono text-2xs text-muted-foreground">{relativeTime(p.postedAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
