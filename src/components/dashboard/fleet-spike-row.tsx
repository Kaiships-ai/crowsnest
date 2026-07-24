import Link from "next/link";

import type { FleetSpike } from "@/server/queries/dashboard";
import { Sparkline } from "./sparkline";

/** DESIGN.md §2.1: a simple list row (not a table) — status dot + Fleet name + delta
 * text + inline sparkline, the whole row linking to the Feed pre-filtered to that Fleet. */
export function FleetSpikeRow({ spike }: { spike: FleetSpike }) {
  return (
    <Link
      href={`/feed?fleet=${spike.fleetId}`}
      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-secondary/60"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />
        <span className="truncate font-medium">{spike.fleetName}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        +{spike.newOutliers7d} new outlier{spike.newOutliers7d === 1 ? "" : "s"} this week
      </span>
      <Sparkline values={spike.sparkline} />
    </Link>
  );
}
