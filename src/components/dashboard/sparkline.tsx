const WIDTH = 64;
const HEIGHT = 20;
const MUTED = "#767D93"; // de-emphasis gray, DESIGN.md §5 dataviz notes
const ACCENT = "#F5A524"; // accent hue, current period

/**
 * A quiet 12-point trend line (DESIGN.md §5's stat-tile contract): the full series in
 * muted gray, only the current (last) period picked out in the accent hue — no axes,
 * no gridlines, no legend. Shared by the KPI tile and each Fleet spike row so both
 * read the same way.
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
      <polyline points={path} fill="none" stroke={MUTED} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last.x} cy={last.y} r={2} fill={ACCENT} />
    </svg>
  );
}
