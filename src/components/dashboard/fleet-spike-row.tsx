import Link from "next/link";

import type { FleetSpike } from "@/server/queries/dashboard";
import { Sparkline } from "./sparkline";

/**
 * DESIGN.md §2.1: a simple list row (not a table) — status marker + Fleet name +
 * delta text + inline sparkline, the whole row linking to the Feed pre-filtered to
 * that Fleet.
 *
 * Row treatment (hover fill, min-height, hairline divider from the parent list) and
 * the marker shape both come from the prototype's row convention (`docs/design/
 * from-claude-design/Crowsnest-Prototype.dc.html` "coverage"/"ranking" rows, screen
 * `dashboard`, line 386): `background:var(--s1)` on hover — mapped to `bg-card` per
 * the shared token table — and square (not round) markers, since radius is 0
 * everywhere on this screen except buttons. The marker stays a neutral gray rather
 * than the amber score color: this dot means "has a spike," not "beat baseline,"
 * and amber is reserved for the latter.
 */
export function FleetSpikeRow({ spike }: { spike: FleetSpike }) {
  return (
    <Link
      href={`/feed?fleet=${spike.fleetId}`}
      className="flex min-h-10 items-center justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-card"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="size-1.5 shrink-0 bg-muted-foreground" />
        <span className="truncate text-sm font-medium text-foreground">{spike.fleetName}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        +<span data-num className="font-mono">{spike.newOutliers7d}</span> new outlier
        {spike.newOutliers7d === 1 ? "" : "s"} this week
      </span>
      <Sparkline values={spike.sparkline} />
    </Link>
  );
}
