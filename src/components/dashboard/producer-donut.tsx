import Link from "next/link";

import type { FeedItem } from "@/server/queries/feed";
import { buildProducerDonut } from "./dashboard-chart-data";

const CIRCUMFERENCE = 2 * Math.PI * 46;

// Categorical, not score-tiered: this ramp tells channels apart, it doesn't grade a
// magnitude, so it deliberately does NOT reach for `--score-1`..`--score-5` (that ramp
// escalates score tiers — using it here would assert a "which is more" reading a
// producer's identity doesn't carry). Same reasoning `fleet-spike-row.tsx` gives for
// keeping its own marker neutral: amber is reserved for the score, not spent on
// telling two channels apart.
//
// The four neutrals used to be spelled out here as `--foreground`, `--line-strong`,
// `--muted-foreground`, `--faint`. They now come from the named categorical palette in
// `globals.css`, which aliases those same four, so the values are unchanged and the
// next chart that needs to tell series apart has something to reach for by name.
// See DESIGN-SYSTEM.md section 2.1.
const SLICE_COLORS = [
  "var(--chart-categorical-1)",
  "var(--chart-categorical-2)",
  "var(--chart-categorical-3)",
  "var(--chart-categorical-4)",
];

/**
 * "Who produces them" (v1-scope.md P1 list): share of the posts that beat their own
 * channel, by channel. Only channels that actually have at least one such post get a
 * slice — a channel that's never synced can't produce one, so it never fabricates a
 * zero-width sliver for itself.
 */
export function ProducerDonut({ items }: { items: FeedItem[] }) {
  const { slices, outlierTotal, postTotal } = buildProducerDonut(items);

  if (outlierTotal === 0) {
    return (
      <div className="min-w-0">
        <span data-lab className="font-mono text-2xs text-faint">
          Who produces them
        </span>
        <p className="mt-6 max-w-[52ch] text-sm text-muted-foreground">
          No post has beaten its own channel yet, so there is nothing to attribute.
        </p>
      </div>
    );
  }

  // Cumulative start fraction per slice, computed without mutating a variable across
  // render (the react-compiler lint flags that pattern) — `slices.length` is at most a
  // handful of channels, so the O(n²) reduce-of-a-slice is free in practice.
  const fractions = slices.map((slice) => slice.count / outlierTotal);
  const starts = fractions.map((_, i) => fractions.slice(0, i).reduce((sum, f) => sum + f, 0));
  const arcs = slices.map((slice, i) => {
    const frac = fractions[i];
    // The 4px gap between wedges only makes sense once there's a second wedge to
    // separate from — a single 100% slice draws as a full, unbroken ring.
    const dash = Math.max(0, frac * CIRCUMFERENCE - (slices.length > 1 ? 4 : 0));
    const gap = CIRCUMFERENCE - dash;
    const offset = -starts[i] * CIRCUMFERENCE;
    return {
      ...slice,
      color: SLICE_COLORS[i % SLICE_COLORS.length],
      dash: `${dash.toFixed(2)} ${gap.toFixed(2)}`,
      offset: offset.toFixed(2),
    };
  });
  const top = arcs[0];

  return (
    <div className="min-w-0">
      <span data-lab className="font-mono text-2xs text-faint">
        Who produces them
      </span>
      <div className="mt-6 flex items-center gap-10">
        <svg
          width={168}
          height={168}
          viewBox="0 0 120 120"
          role="img"
          aria-label={`Donut chart, share of posts that beat their channel, by channel. ${top.handle} produced ${top.pct}%.`}
          className="-rotate-90 shrink-0"
        >
          <circle cx={60} cy={60} r={46} fill="none" style={{ stroke: "var(--secondary)" }} strokeWidth={13} />
          {arcs.map((arc) => (
            <circle
              key={arc.channelId || "other"}
              cx={60}
              cy={60}
              r={46}
              fill="none"
              style={{ stroke: arc.color }}
              strokeWidth={13}
              strokeDasharray={arc.dash}
              strokeDashoffset={arc.offset}
            />
          ))}
        </svg>
        <div className="flex flex-col gap-3.5">
          {/* The folded "Other" slice has no channelId — it stands for several channels,
              so it gets no link. Every other row still goes to its channel. */}
          {arcs.map((arc) =>
            arc.channelId ? (
              <Link
                key={arc.channelId}
                href={`/channels/${arc.channelId}`}
                className="flex items-center gap-3 hover:underline"
              >
                <span aria-hidden className="size-2 shrink-0" style={{ background: arc.color }} />
                <span className="min-w-[160px] text-sm text-foreground">{arc.handle}</span>
                <span data-num className="font-mono text-sm text-muted-foreground">
                  {arc.count}
                </span>
              </Link>
            ) : (
              <div key="other" className="flex items-center gap-3">
                <span aria-hidden className="size-2 shrink-0" style={{ background: arc.color }} />
                <span className="min-w-[160px] text-sm text-muted-foreground">{arc.handle}</span>
                <span data-num className="font-mono text-sm text-muted-foreground">
                  {arc.count}
                </span>
              </div>
            )
          )}
        </div>
      </div>
      <p className="mt-5 max-w-[52ch] text-sm text-muted-foreground">
        Share of the <span data-num>{outlierTotal}</span> post{outlierTotal === 1 ? "" : "s"} that beat their channel, not of
        all <span data-num>{postTotal}</span> synced · <span data-num>{top.pct}%</span> came from {top.handle}
      </p>
    </div>
  );
}
