import { scalePosition } from "@/components/video/median-baseline";
import { formatCompact, formatMultiplier } from "@/lib/format";
import type { FeedItem } from "@/server/queries/feed";
import { buildScatterPoints, viewScalePosition } from "./dashboard-chart-data";

const WIDTH = 520;
const HEIGHT = 200;
const PAD_LEFT = 44;
const PAD_RIGHT = 8;
const PAD_TOP = 14;
const PAD_BOTTOM = 10;

/**
 * "Reach vs score" (v1-scope.md P1 list): every scored post, view count on a log x-axis
 * against its own score on the same 0.2x-12x log scale the video detail median bar uses
 * (`scalePosition`, imported rather than re-derived, so the two screens can't quietly
 * disagree about what the scale means). Dot color is the same binary "beat its channel
 * or not" amber/dim read as everywhere else — this dot's y-position already *is* the
 * score, so unlike a view-count series, coloring it off the score isn't asserting a
 * reading the data doesn't contain.
 */
export function ReachScoreScatter({ items }: { items: FeedItem[] }) {
  const { points, omitted } = buildScatterPoints(items);

  if (points.length === 0) {
    return (
      <div className="min-w-0">
        <span data-lab className="font-mono text-2xs text-muted-foreground">
          Reach vs score
        </span>
        <p className="mt-6 max-w-[52ch] text-sm text-muted-foreground">
          No post has both a score and a view count yet, so there is nothing to plot.
        </p>
      </div>
    );
  }

  const x = (views: number) => PAD_LEFT + viewScalePosition(views) * (WIDTH - PAD_LEFT - PAD_RIGHT);
  const y = (score: number) => HEIGHT - PAD_BOTTOM - scalePosition(score) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
  const beatY = y(1);
  const beatCount = points.filter((p) => p.beat).length;

  return (
    <div className="min-w-0">
      <span data-lab className="font-mono text-2xs text-muted-foreground">
        Reach vs score
      </span>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Scatter plot, log reach against outlier score. ${points.length} posts; ${beatCount} beat their channel median.`}
        className="mt-6 h-auto w-full overflow-visible"
      >
        <line x1={PAD_LEFT} y1={beatY} x2={WIDTH - PAD_RIGHT} y2={beatY} className="stroke-border" strokeWidth={1} />
        <text x={PAD_LEFT - 6} y={beatY} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground font-mono text-2xs">
          1×
        </text>
        <text x={PAD_LEFT - 6} y={PAD_TOP + 4} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground font-mono text-2xs">
          12×
        </text>
        <text x={PAD_LEFT} y={HEIGHT - 2} textAnchor="start" className="fill-muted-foreground font-mono text-2xs">
          1K
        </text>
        <text x={WIDTH / 2} y={HEIGHT - 2} textAnchor="middle" className="fill-muted-foreground font-mono text-2xs">
          100K
        </text>
        <text x={WIDTH - PAD_RIGHT} y={HEIGHT - 2} textAnchor="end" className="fill-muted-foreground font-mono text-2xs">
          10M
        </text>
        {points.map((p) => (
          <circle key={p.videoId} cx={x(p.viewCount)} cy={y(p.score)} r={p.beat ? 5 : 3.5} style={{ fill: p.beat ? "var(--primary)" : "var(--muted-foreground)" }}>
            <title>{`${p.handle} · ${formatMultiplier(p.score)} · ${formatCompact(p.viewCount)} views`}</title>
          </circle>
        ))}
      </svg>
      <p className="mt-5 max-w-[52ch] text-sm text-muted-foreground">
        <span data-num>{points.length}</span> post{points.length === 1 ? "" : "s"} plotted
        {omitted > 0 ? `, ${omitted} left out for missing a score or a view count` : ""} — reach on a log scale, score against
        each post&rsquo;s own channel median.
      </p>
    </div>
  );
}
