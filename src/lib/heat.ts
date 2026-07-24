// Heat-tier + follower-band classification. Hex values for rendering tiers live in
// components (DESIGN.md §4.1 verbatim) — this file only decides which tier/band a
// number falls in.

/** 0 = below 2x (or null score) — never rendered with a badge fill, just the "—" chip. */
export type HeatTier = 0 | 1 | 2 | 3 | 4;

/** [2,5) -> 1, [5,10) -> 2, [10,20) -> 3, >=20 -> 4, null or <2 -> 0. */
export function heatTier(score: number | null): HeatTier {
  if (score === null) return 0;
  if (score >= 20) return 4;
  if (score >= 10) return 3;
  if (score >= 5) return 2;
  if (score >= 2) return 1;
  return 0;
}

export type FollowerBand = "nano" | "micro" | "mid" | "macro";

/** nano <10K, micro 10K-100K, mid 100K-1M, macro >=1M (DESIGN.md §2.2). */
export function followerBandOf(count: number | null): FollowerBand | null {
  if (count === null) return null;
  if (count >= 1_000_000) return "macro";
  if (count >= 100_000) return "mid";
  if (count >= 10_000) return "micro";
  return "nano";
}
