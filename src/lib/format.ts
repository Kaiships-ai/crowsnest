// Intl-free, deterministic number/time formatting — see docs/superpowers/plans/
// 2026-07-23-phase2b-research-ui.md Task 2 for the exact contract.

const COMPACT_TIERS: [value: number, suffix: string][] = [
  [1_000_000_000, "B"],
  [1_000_000, "M"],
  [1_000, "K"],
];

/** 2400000 -> "2.4M", 45300 -> "45.3K", 999 -> "999", null -> "—". One decimal, trailing .0 dropped. */
export function formatCompact(n: number | null): string {
  if (n === null) return "—";
  if (n < 1000) return String(n);
  for (const [value, suffix] of COMPACT_TIERS) {
    if (n >= value) {
      const scaled = (n / value).toFixed(1);
      return (scaled.endsWith(".0") ? scaled.slice(0, -2) : scaled) + suffix;
    }
  }
  return String(n);
}

/**
 * 0.042 -> "4.2%", null -> "—". The query layer hands over a raw ratio (never a
 * percentage, never rounded — see FeedItem.engagementRate) so this is the one place
 * that multiplies by 100 and rounds. Only a null input prints the dash; a genuinely
 * tiny but known rate still prints "0.0%" rather than being mistaken for "unknown".
 */
export function formatEngagementRate(rate: number | null): string {
  if (rate === null) return "—";
  const pct = rate * 100;
  // Below one percent, a single decimal is not precision, it is distortion: @kallaway's
  // top post engages 0.05 percent and one decimal rounds that to 0.1, doubling it. Two
  // decimals under 1 percent, one above, where a tenth is a real difference and a
  // hundredth is noise.
  if (pct > 0 && pct < 1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

/**
 * 12.4 -> "12.4×", null -> "—". Always exactly one decimal (unlike formatCompact) —
 * the multiplier badge numeral is set in tabular-nums (DESIGN.md §4.2) specifically
 * so magnitudes align scanning down a card grid; dropping a trailing zero (38.0 -> 38)
 * would break that alignment and contradicts the "38.0×" shown in DESIGN.md §2.2.
 */
export function formatMultiplier(s: number | null): string {
  if (s === null) return "—";
  return `${s.toFixed(1)}×`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** "3d ago", "2h ago", "5m ago", "just now" — relative to Date.now() at call time. */
export function relativeTime(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  if (deltaMs < MINUTE_MS) return "just now";
  if (deltaMs < HOUR_MS) return `${Math.floor(deltaMs / MINUTE_MS)}m ago`;
  if (deltaMs < DAY_MS) return `${Math.floor(deltaMs / HOUR_MS)}h ago`;
  return `${Math.floor(deltaMs / DAY_MS)}d ago`;
}

/** plural("result", 1) -> "result", plural("result", 2) -> "results", plural("result", 0) -> "results". */
export function plural(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

/** 34 -> "0:34", 95 -> "1:35", null -> "". M:SS, seconds zero-padded, no leading zero on minutes. */
export function formatDuration(sec: number | null): string {
  if (sec === null) return "";
  const minutes = Math.floor(sec / 60);
  const seconds = Math.floor(sec % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
