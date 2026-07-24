import { formatMultiplier } from "@/lib/format";
import { heatTier } from "@/lib/heat";
import { cn } from "@/lib/utils";

// Heat ramp — hex/rgba values verbatim from DESIGN.md §4.1's tier table. Not built
// from shadcn's badgeVariants: the gradient + glow on tier 4 and the exact translucent
// amber fills on tiers 1-2 don't map onto that variant set.
const TIER_STYLES: Record<1 | 2 | 3 | 4, string> = {
  1: "border border-[rgba(245,165,36,.35)] bg-[rgba(245,165,36,.10)] text-[#C98A4A]",
  2: "border border-[rgba(245,165,36,.5)] bg-[rgba(245,165,36,.16)] text-[#F5A524]",
  3: "border-transparent bg-[#F5A524] text-[#14100A]",
  4: "border-transparent bg-[linear-gradient(135deg,#FF7A1A,#FF3D3D)] text-[#1A1300] shadow-[0_0_16px_rgba(255,90,26,.45)]",
};
const QUIET_STYLE = "border border-border bg-transparent text-muted-foreground";

export function OutlierBadge({
  score,
  size = "sm",
}: {
  score: number | null;
  size?: "sm" | "lg";
}) {
  const tier = heatTier(score);

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
