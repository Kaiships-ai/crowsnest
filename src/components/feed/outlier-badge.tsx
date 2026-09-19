import { formatMultiplier } from "@/lib/format";
import { heatTier } from "@/lib/heat";
import { cn } from "@/lib/utils";

// Heat ramp off the prototype's amber tokens. DESIGN.md §4.1 lists a different table
// built on #F5A524, the accent this project used before the prototype landed, and it
// escalates tier 4 with a gradient and a glow. The prototype has neither, and where it
// and a written doc disagree the prototype wins, so the ramp reads: wash and hairline
// for a small beat, solid amber once the beat is loud enough to deserve the fill.
const TIER_STYLES: Record<1 | 2 | 3 | 4, string> = {
  1: "border border-primary/30 bg-primary/10 text-[var(--chart-2)]",
  2: "border border-primary/30 bg-primary/10 text-primary",
  3: "border-transparent bg-primary text-[var(--primary-foreground)]",
  4: "border-transparent bg-primary text-[var(--primary-foreground)] font-bold",
};
const QUIET_STYLE = "border border-border bg-transparent text-muted-foreground";

/** B-18 / FEED-17: the hero badge's own heat escalation — a wash below 5x, solid amber
 *  from 5x, bolder past 20x. Deliberately not `heatTier` above: that ladder's bands
 *  (2/5/10/20) exist for the pill badge's fill+text combo, but the hero variant turns
 *  amber at 1x, not 2x (see the comment on the "hero" branch below for why), so it needs
 *  its own three-way split of the amber range instead. */
export type HeroTier = "quiet" | "wash" | "solid" | "bold";

export function heroTier(score: number | null): HeroTier {
  if (score === null || score < 1) return "quiet";
  if (score >= 20) return "bold";
  if (score >= 5) return "solid";
  return "wash";
}

const HERO_TIER_STYLES: Record<HeroTier, string> = {
  quiet: "text-muted-foreground",
  wash: "text-[var(--chart-2)]",
  solid: "text-primary",
  bold: "text-primary font-bold",
};

export function OutlierBadge({
  score,
  size = "sm",
}: {
  score: number | null;
  size?: "sm" | "lg" | "hero";
}) {
  const tier = heatTier(score);

  // "hero": the Outlier Feed card's own read of the score (feed.html line 80), plain
  // mono text, no pill chrome, sized to be the biggest thing on the card.
  //
  // Amber turns on at 1.0, not at the badge ramp's first tier. Amber means one thing in
  // this design, that the post beat its channel, and beating it starts the moment the
  // score passes 1.0. heatTier is a separate scale for how hard it beat, and its tier 1
  // does not begin until 2.0, so reading the hero off tiers painted a 1.1x post grey
  // while the detail screen painted the same post amber. Same number, two answers, and
  // acceptance criterion 8 settles it at 1.0. `heroTier` above keeps that 1.0 threshold
  // (its "quiet" branch) and adds the 5x/20x escalation FEED-17 wants on top of it.
  if (size === "hero") {
    return (
      <span
        data-num="1"
        className={cn(
          "font-mono text-lg leading-none font-medium tracking-tight",
          HERO_TIER_STYLES[heroTier(score)]
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
