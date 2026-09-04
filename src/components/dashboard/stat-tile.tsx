import { ArrowDown, ArrowUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";

export interface StatTileDelta {
  label: string;
  direction: "up" | "down";
  /** Which direction counts as "good" (colored critical vs. plain) — defaults to
   * "up" (more is better), the common case for every stat tile on this Dashboard. */
  goodDirection?: "up" | "down";
}

/**
 * DESIGN.md §5's stat-tile contract: sentence-case label (no trailing colon),
 * semibold auto-compact value, an optional signed delta colored by direction × whether
 * up is good — always paired with an up/down icon, never color alone — and an
 * optional 12-point sparkline.
 *
 * Color: a "good" delta uses `text-pos` (the prototype's `--pos`, `#6fad86`, now
 * wired into `globals.css` as a shared token) alongside the ↑ icon — never color
 * alone. A "bad" delta gets `text-destructive`. Green over plain foreground reads
 * clearly on a KPI row where several tiles carry a delta at once; the ↑/↓ icon is
 * still the primary signal so the color is reinforcement, not the only cue.
 */
export function StatTile({
  label,
  value,
  caption,
  delta,
  sparkline,
}: {
  label: string;
  value: string;
  /** Small context line under the value for a time-boxed figure (e.g. "7d") — the
   * dashboard KPI mock (DESIGN.md §2.1) pairs "New outliers" with a "this wk" line
   * so the window the count was drawn from is never left implicit. */
  caption?: string;
  delta?: StatTileDelta;
  sparkline?: number[];
}) {
  const isGood = delta ? delta.direction === (delta.goodDirection ?? "up") : null;
  // A missing value is a dash, never a zero (non-negotiable rule) — distinct from a
  // genuine zero count, which every field on this screen already returns as "0".
  const displayValue = value.trim() === "" ? "—" : value;

  return (
    <Card className="rounded-none">
      <CardContent className="flex flex-col gap-1.5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p data-num className="font-mono text-lg font-semibold text-foreground">
          {displayValue}
        </p>
        {caption && (
          <p data-num className="font-mono text-2xs text-faint">
            {caption}
          </p>
        )}
        {/* min-h-4 reserves the same vertical space whether or not a tile has a real
            delta — three of the four dashboard tiles pass none, and letting this row
            collapse to 0 when empty is what made the stat row read uneven. */}
        <div className="flex min-h-4 items-center gap-2">
          {delta && (
            <span
              data-num
              className={cn(
                "flex items-center gap-0.5 font-mono text-2xs font-medium",
                isGood ? "text-pos" : "text-destructive"
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
