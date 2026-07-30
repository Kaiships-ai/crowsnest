import { formatMultiplier } from "@/lib/format";
import { heatTier } from "@/lib/heat";
import { cn } from "@/lib/utils";

// Heat ramp off the prototype's amber tokens. DESIGN.md §4.1 lists a different table
// built on #F5A524, the accent this project used before the prototype landed, and it
// escalates tier 4 with a gradient and a glow. The prototype has neither, and where it
// and a written doc disagree the prototype wins, so the ramp reads: wash and hairline
// for a small beat, solid amber once the beat is loud enough to deserve the fill.
const TIER_STYLES: Record<1 | 2 | 3 | 4, string> = {
  1: "border border-score-line bg-score-wash text-[var(--score-2)]",
  2: "border border-score-line bg-score-wash text-score",
  3: "border-transparent bg-score text-[var(--score-on)]",
  4: "border-transparent bg-score text-[var(--score-on)] font-bold",
};
const QUIET_STYLE = "border border-border bg-transparent text-muted-foreground";

export function OutlierBadge({
  score,
  size = "sm",
}: {
  score: number | null;
  size?: "sm" | "lg" | "hero";
}) {
  const tier = heatTier(score);

  // "hero": the Outlier Feed card's own read of the score (feed.html line 80) — plain
  // mono text, no pill chrome, sized to be the biggest thing on the card. Amber means
  // one thing (beat the channel baseline), so anything under tier 1 reads in a quiet
  // neutral tone rather than a duller amber that would blur that meaning.
  if (size === "hero") {
    return (
      <span
        data-num="1"
        className={cn(
          "font-mono text-lg leading-none font-medium tracking-tight",
          tier === 0 ? "text-faint" : "text-score"
        )}
      >
        {formatMultiplier(score)}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center justify-center rounded-full font-semibold tabular-nums",
        size === "lg" ? "h-8 px-3 text-base" : "h-6 px-2.5 text-xs",
        tier === 0 ? QUIET_STYLE : TIER_STYLES[tier]
      )}
    >
      {formatMultiplier(score)}
    </span>
  );
}
