import Link from "next/link";

import { FleetSpikeRow } from "@/components/dashboard/fleet-spike-row";
import { OutlierScrollRow } from "@/components/dashboard/outlier-scroll-row";
import { StatTile } from "@/components/dashboard/stat-tile";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getDashboardStats,
  getFleetSpikes,
  getRecentlyViewed,
  getTopOutliersToday,
} from "@/server/queries/dashboard";

// Unlike every other route in this app, `/` has no searchParams and no dynamic route
// segment to implicitly opt it out of static rendering — without this, `next build`
// would prerender the KPIs/outliers/spikes once at build time and freeze them there,
// which is wrong for numbers meant to reflect the live local DB on every visit.
export const dynamic = "force-dynamic";

// Topbar already renders this route's h1 ("Dashboard") — see nav-items/topbar's
// ROUTE_TITLES — so page content here starts directly at the KPI row.
export default async function DashboardPage() {
  const [stats, topOutliers, fleetSpikes, recentlyViewed] = await Promise.all([
    getDashboardStats(),
    getTopOutliersToday(),
    getFleetSpikes(),
    getRecentlyViewed(),
  ]);

  // True-empty (DESIGN.md §6 spirit): zero channels tracked means every KPI would
  // read 0 and every section would be empty — one clear "get started" state instead
  // of four separate empty sub-states stacked on top of each other.
  if (stats.channelsTracked === 0) {
    return (
      <div className="mx-auto flex max-w-[1120px] flex-col items-center gap-3 p-6 py-24 text-center">
        <p className="text-sm text-muted-foreground">No channels tracked yet — add one to start seeing outliers here.</p>
        <Link href="/channels" className={cn(buttonVariants({ variant: "default" }))}>
          Add your first channel
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-8 p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Channels tracked"
          value={String(stats.channelsTracked)}
          delta={
            stats.channelsDelta7d !== 0
              ? {
                  label: `${stats.channelsDelta7d > 0 ? "+" : ""}${stats.channelsDelta7d}`,
                  direction: stats.channelsDelta7d >= 0 ? "up" : "down",
                }
              : undefined
          }
          sparkline={stats.viewsSparkline}
        />
        <StatTile label="New outliers" value={String(stats.newOutliers7d)} />
        <StatTile label="Vaulted this week" value={String(stats.vaultedThisWeek)} />
        <StatTile label="Scripts drafted" value={String(stats.scriptsDrafted)} />
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Today&rsquo;s top outliers</h2>
          <Link href="/feed" className="text-sm text-muted-foreground hover:text-foreground">
            View all in Feed →
          </Link>
        </div>
        {topOutliers.length > 0 ? (
          <OutlierScrollRow items={topOutliers} />
        ) : (
          <p className="text-sm text-muted-foreground">Analyze more videos to see patterns here.</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Fleets with new spikes</h2>
        {fleetSpikes.length > 0 ? (
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {fleetSpikes.map((spike) => (
              <FleetSpikeRow key={spike.fleetId} spike={spike} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No new spikes this week.</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Recently viewed</h2>
        {recentlyViewed.length > 0 ? (
          <OutlierScrollRow items={recentlyViewed} />
        ) : (
          <p className="text-sm text-muted-foreground">Videos you open will show up here.</p>
        )}
      </section>
    </div>
  );
}
