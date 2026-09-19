import Link from "next/link";

import type { ChannelRow } from "@/server/queries/channels";
import type { FeedItem } from "@/server/queries/feed";
import { buildCoverage } from "./dashboard-chart-data";

// Same hatch treatment `channel-table.tsx` gives a never-synced row and `outlier-card.tsx`
// gives an empty media well — one visual vocabulary for "nothing here yet" across the app.
const HATCH_STYLE: React.CSSProperties = {
  backgroundColor: "color-mix(in srgb, var(--muted-foreground) 5%, transparent)",
  backgroundImage: "repeating-linear-gradient(135deg, color-mix(in srgb, var(--muted-foreground) 16%, transparent) 0px, color-mix(in srgb, var(--muted-foreground) 16%, transparent) 1px, transparent 1px, transparent 10px)",
};

/**
 * "Coverage list" (v1-scope.md P1 list): live post count per tracked channel. Bar fill
 * is a neutral gray, not amber — a post count isn't a score, and the amber budget
 * (globals.css: "allowed on the score, and on exactly one primary action per screen")
 * doesn't stretch to cover it. A never-synced channel gets the hatch and a dash, never
 * a zero-width bar standing in for "0 posts" it never actually measured.
 */
export function CoverageList({ channels, items }: { channels: ChannelRow[]; items: FeedItem[] }) {
  const rows = buildCoverage(channels, items);
  if (rows.length === 0) return null;

  const max = Math.max(1, ...rows.map((r) => r.liveCount));

  return (
    <div>
      <span data-lab className="font-mono text-2xs text-muted-foreground">
        Coverage
      </span>
      <div className="mt-6 flex max-w-[720px] flex-col gap-4">
        {rows.map((row) => (
          <Link
            key={row.channelId}
            href={`/channels/${row.channelId}`}
            className="grid min-h-10 grid-cols-[minmax(0,230px)_minmax(0,1fr)_minmax(0,90px)] items-center gap-6 hover:bg-card"
          >
            <span className={row.neverSynced ? "truncate text-muted-foreground" : "truncate text-foreground"}>{row.handle}</span>
            <span aria-hidden className="h-1.5 bg-secondary" style={row.neverSynced ? HATCH_STYLE : undefined}>
              {!row.neverSynced && (
                <span className="block h-1.5 bg-border" style={{ width: `${Math.round((row.liveCount / max) * 100)}%` }} />
              )}
            </span>
            <span data-num className="text-right font-mono text-xs text-muted-foreground">
              {row.neverSynced ? "—" : `${row.liveCount} post${row.liveCount === 1 ? "" : "s"}`}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
