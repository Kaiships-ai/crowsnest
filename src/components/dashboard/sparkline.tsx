const WIDTH = 64;
const HEIGHT = 20;

/**
 * A quiet 12-point trend line (DESIGN.md §5's stat-tile contract): the full series in
 * muted gray, only the current (last) period picked out in the accent hue — no axes,
 * no gridlines, no legend. Shared by the KPI tile and each Fleet spike row so both
 * read the same way.
 *
 * Colors read from the live CSS custom properties (`--muted-foreground`, `--score`)
 * rather than a hardcoded hex, so the line always tracks whatever `globals.css`
 * currently defines.
 *
 * Does not use the `--score-1`..`--score-5` ramp: that 5-step amber ramp encodes
 * score *tiers* (how far above baseline a post ran), and the series here is a plain
 * view-count sum per bucket (`bucketViewsByPostedAt` in `server/queries/dashboard`)
 * with no score attached to a bucket to tier against. Coloring buckets by magnitude
 * would imply a score reading that isn't in the data — dropped rather than faked,
 * per the shared brief's disagreement rule.
 */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) return null;

  const max = Math.max(...values, 1);
  const stepX = values.length > 1 ? WIDTH / (values.length - 1) : 0;
  const points = values.map((v, i) => ({
    x: i * stepX,
    y: HEIGHT - (v / max) * HEIGHT,
  }));
  const path = points.map((p) => `${p.x},${p.y}`).join(" ");
  const last = points[points.length - 1];

  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Trend sparkline" className="shrink-0">
      <polyline
        points={path}
        fill="none"
        stroke="var(--muted-foreground)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last.x} cy={last.y} r={2} fill="var(--primary)" />
    </svg>
  );
}
