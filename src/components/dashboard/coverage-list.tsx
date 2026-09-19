import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
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
 * is the neutral border token, not an emphasis colour - a post count is not a score, and
 * emphasis on this screen is spent on the one primary action, not on a raw count. A
 * never-synced channel gets the hatch and a dash, never a zero-width bar standing in for
 * "0 posts" it never actually measured.
 */
export function CoverageList({ channels, items }: { channels: ChannelRow[]; items: FeedItem[] }) {
  const rows = buildCoverage(channels, items);
  if (rows.length === 0) return null;

  const max = Math.max(1, ...rows.map((r) => r.liveCount));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Coverage</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead>
                <span className="sr-only">Live posts, relative to the busiest channel</span>
              </TableHead>
              <TableHead className="text-right">Posts</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              // `relative` on the row plus the link's `after:inset-0` keeps the whole row
              // clickable without nesting an anchor per cell: one link, one accessible
              // name, the same hit area the hand-rolled grid row had.
              <TableRow key={row.channelId} className="relative">
                <TableCell className="w-[230px] max-w-[230px]">
                  <Link
                    href={`/channels/${row.channelId}`}
                    className={cn(
                      "block truncate after:absolute after:inset-0",
                      row.neverSynced ? "text-muted-foreground" : "text-foreground"
                    )}
                  >
                    {row.handle}
                  </Link>
                </TableCell>
                <TableCell>
                  <span aria-hidden className="block h-1.5 bg-secondary" style={row.neverSynced ? HATCH_STYLE : undefined}>
                    {!row.neverSynced && (
                      <span className="block h-1.5 bg-border" style={{ width: `${Math.round((row.liveCount / max) * 100)}%` }} />
                    )}
                  </span>
                </TableCell>
                <TableCell data-num className="w-[110px] text-right font-mono text-xs text-muted-foreground">
                  {row.neverSynced ? "—" : `${row.liveCount} post${row.liveCount === 1 ? "" : "s"}`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
