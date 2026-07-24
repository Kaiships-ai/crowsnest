import { ArrowDown, ArrowUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";

export interface StatTileDelta {
  label: string;
  direction: "up" | "down";
  /** Which direction counts as "good" (colored success vs. critical) — defaults to
   * "up" (more is better), the common case for every stat tile on this Dashboard. */
  goodDirection?: "up" | "down";
}

/**
 * DESIGN.md §5's stat-tile contract: sentence-case label (no trailing colon),
 * semibold auto-compact value, an optional signed delta colored by direction × whether
 * up is good — always paired with an up/down icon, never color alone — and an
 * optional 12-point sparkline.
 */
export function StatTile({
  label,
  value,
  delta,
  sparkline,
}: {
  label: string;
  value: string;
  delta?: StatTileDelta;
  sparkline?: number[];
}) {
  const isGood = delta ? delta.direction === (delta.goodDirection ?? "up") : null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-1.5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <div className="flex items-center gap-2">
          {delta && (
            <span
              className={cn(
                "flex items-center gap-0.5 text-xs font-medium",
                isGood ? "text-[#34D399]" : "text-[#F1585C]"
              )}
            >
              {delta.direction === "up" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
              {delta.label}
            </span>
          )}
          {sparkline && sparkline.length > 0 && <Sparkline values={sparkline} />}
        </div>
      </CardContent>
    </Card>
  );
}
