import { Badge } from "@/components/ui/badge";
import { formatMultiplier } from "@/lib/format";
import { heatTier, type HeatTier } from "@/lib/heat";
import { cn } from "@/lib/utils";

// Heat ramp off the prototype. DESIGN.md §4.1 lists a different table and escalates
// tier 4 with a gradient and a glow; the prototype has neither, and where it and a
// written doc disagree the prototype wins. So the ramp reads: a hairline and a wash
// for a small beat, a solid fill once the beat is loud enough to deserve one.
//
// Tier 0 and tiers 3-4 are exactly Badge's own `outline` and `default` tones, so they
// carry no classes of their own. Only the two wash tiers need any: "translucent fill
// behind a hairline border" is not one of Badge's variants, and the tier-1 text color
// is the chart ramp's second step, which no variant carries either.
const TIER_VARIANT: Record<HeatTier, "outline" | "default"> = {
  0: "outline",
  1: "outline",
  2: "outline",
  3: "default",
  4: "default",
};
const TIER_CLASS: Record<HeatTier, string> = {
  0: "",
  1: "border-primary/30 bg-primary/10 text-[var(--chart-2)]",
  2: "border-primary/30 bg-primary/10 text-primary",
  3: "",
  4: "font-bold",
};

/** B-18 / FEED-17: the hero read's own heat escalation, a wash below 5x, the signal
 *  color from 5x, bolder past 20x. Deliberately not `heatTier` above: that ladder's
 *  bands (2/5/10/20) exist for the pill badge's fill+text combo, but the hero read
 *  lights up at 1x, not 2x (see the comment on the "hero" branch below for why), so it
 *  needs its own three-way split instead. */
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
  // mono text, sized to be the biggest thing on the card. Deliberately not a Badge:
  // it is a headline number, not a pill, and pill chrome (border, fill, padding, a
  // 12px cap on the type) would take the card's loudest read away from it.
  //
  // The signal color turns on at 1.0, not at the badge ramp's first tier. It means one
  // thing in this design, that the post beat its channel, and beating it starts the
  // moment the score passes 1.0. heatTier is a separate scale for how hard it beat, and
  // its tier 1 does not begin until 2.0, so reading the hero off tiers painted a 1.1x
  // post grey while the detail screen painted the same post lit. Same number, two
  // answers, and acceptance criterion 8 settles it at 1.0. `heroTier` above keeps that
  // 1.0 threshold (its "quiet" branch) and adds the 5x/20x escalation FEED-17 wants.
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

  // `lg` is the one size override left: it is the badge that floats over a thumbnail on
  // the quick-preview sheet and the detail page, where the stock 20px pill is too small
  // to read against moving artwork. `sm` takes Badge's own size.
  return (
    <Badge
      variant={TIER_VARIANT[tier]}
      className={cn("tabular-nums", size === "lg" && "h-8 px-3 text-base", TIER_CLASS[tier])}
    >
      {formatMultiplier(score)}
    </Badge>
  );
}
