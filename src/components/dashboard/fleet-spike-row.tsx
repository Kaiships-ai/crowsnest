import Link from "next/link";

import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import type { FleetSpike } from "@/server/queries/dashboard";
import { Sparkline } from "./sparkline";

/**
 * DESIGN.md section 2.1: a simple list row (not a table) - status marker + Fleet name +
 * delta text + inline sparkline, the whole row linking to the Feed pre-filtered to that
 * Fleet. The row is one `Item` rendered as the link, so the hover fill, the hit area and
 * the row rhythm all come from the shared row primitive instead of a local class ladder.
 *
 * The marker stays a neutral gray rather than a score colour: this dot means "has a
 * spike", not "beat baseline", and reading a magnitude into it would assert something
 * the count does not carry.
 */
export function FleetSpikeRow({ spike }: { spike: FleetSpike }) {
  return (
    <Item render={<Link href={`/feed?fleet=${spike.fleetId}`} />} size="sm">
      <ItemMedia>
        <span aria-hidden className="size-1.5 shrink-0 bg-muted-foreground" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{spike.fleetName}</ItemTitle>
      </ItemContent>
      <ItemActions>
        <span className="shrink-0 text-xs text-muted-foreground">
          +<span data-num className="font-mono">{spike.newOutliers7d}</span> new outlier
          {spike.newOutliers7d === 1 ? "" : "s"} this week
        </span>
        <Sparkline values={spike.sparkline} />
      </ItemActions>
    </Item>
  );
}
