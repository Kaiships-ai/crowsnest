"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatCompact } from "@/lib/format";
import type { ViewsPoint } from "@/server/services/reel-insights";

const CONFIG: ChartConfig = {
  views: { label: "This reel", color: "var(--chart-1)" },
  typical: { label: "Your typical reel", color: "var(--chart-3)" },
};

/** Real measurements only, by whole hour since posting. Lines join adjacent measured hours;
 *  no point is drawn at an hour nobody measured. */
export function ReelViewsOverTime({ points }: { points: ViewsPoint[] }) {
  return (
    <Card data-testid="reels-views-chart">
      <CardHeader>
        <CardTitle>Views over time</CardTitle>
        <CardDescription>Hours since posting, against the median of your other reels at the same hour.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {points.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not enough measurements yet to draw a curve.</p>
        ) : (
          <ChartContainer config={CONFIG} className="aspect-auto h-[220px] w-full" role="img" aria-label="Line chart of this reel's views against your typical reel, by hours since posting.">
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="hour" type="number" domain={[0, "dataMax"]} tickFormatter={(h: number) => `${h}h`} />
              <YAxis width={48} tickFormatter={(v: number) => formatCompact(v)} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line dataKey="views" stroke="var(--color-views)" dot isAnimationActive={false} />
              <Line dataKey="typical" stroke="var(--color-typical)" strokeDasharray="4 4" dot isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
        )}
        <div className="flex gap-4 font-mono text-2xs text-muted-foreground">
          <span>This reel</span>
          <span>Your typical reel</span>
        </div>
      </CardContent>
    </Card>
  );
}
