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
//
// The prototype's `dashboard` screen (line 386) is a denser analytics page than
// this route: a "NEXT" prompt bar, a single big top-post hero, a producer donut,
// a reach-vs-score scatter, a 28-day timeline, a full score-ranking list, and a
// per-channel coverage list — none of which `getDashboardStats`/`getTopOutliersToday`/
// `getFleetSpikes`/`getRecentlyViewed` return data for, and this slice can't touch
// `src/server` to add it. DESIGN.md §2.1's own dashboard mock (KPI row, top-outliers
// scroll row, fleet-spikes list, recently-viewed) matches what this route's queries
// actually provide, so that's the structure kept; only the type scale, spacing
// rhythm (96px between sections, 24px header-to-content), row treatment, and label
// casing are pulled from the prototype. Dropped rather than faked, per the shared
// brief's disagreement rule.
export default async function DashboardPage() {
  const [stats, topOutliers, fleetSpikes, recentlyViewed] = await Promise.all([
    getDashboardStats(),
    getTopOutliersToday(),
    getFleetSpikes(),
    getRecentlyViewed(),
  ]);

  // True-empty (DESIGN.md §6 spirit): zero channels tracked means every KPI would
  // read 0 and every section would be empty — one clear "get started" state instead
  // of four separate empty sub-states stacked on top of each other. Left-aligned
  // headline + supporting line + primary button, max-width 48ch, matches the
  // prototype's own `noPosts` empty state (`dashboard` screen, line 386) rather
  // than the centered single line this used to be.
  if (stats.channelsTracked === 0) {
    return (
      <div className="mx-auto max-w-[1120px] p-6">
        <div className="max-w-[48ch] pt-6 pb-24">
          <p className="text-lg text-foreground">No channels are being watched, so there is nothing to score.</p>
          <p className="mt-5 text-sm text-muted-foreground">
            Add a channel and run a sync — medians take a few posts to settle before scores mean anything.
          </p>
          <Link href="/channels" className={cn(buttonVariants({ variant: "default" }), "mt-8")}>
            Add a channel
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-24 p-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
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
        <StatTile label="New outliers" value={String(stats.newOutliers7d)} caption="7d" />
        <StatTile label="Vaulted this week" value={String(stats.vaultedThisWeek)} />
        <StatTile label="Scripts drafted" value={String(stats.scriptsDrafted)} />
      </div>

      <section className="flex flex-col gap-6">
        <div className="flex items-baseline justify-between gap-6">
          <span data-lab className="font-mono text-2xs text-faint">
            Today&rsquo;s top outliers
          </span>
          <Link href="/feed" className="text-xs text-muted-foreground hover:text-foreground">
            View all in Feed →
          </Link>
        </div>
        {topOutliers.length > 0 ? (
          <OutlierScrollRow items={topOutliers} />
        ) : (
          <p className="text-sm text-muted-foreground">Analyze more videos to see patterns here.</p>
        )}
      </section>

      <section className="flex flex-col gap-6">
        <span data-lab className="font-mono text-2xs text-faint">
          Fleets with new spikes
        </span>
        {fleetSpikes.length > 0 ? (
          <div className="flex flex-col divide-y divide-border border border-border">
            {fleetSpikes.map((spike) => (
              <FleetSpikeRow key={spike.fleetId} spike={spike} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No new spikes this week.</p>
        )}
      </section>

      <section className="flex flex-col gap-6">
        <span data-lab className="font-mono text-2xs text-faint">
          Recently viewed
        </span>
        {recentlyViewed.length > 0 ? (
          <OutlierScrollRow items={recentlyViewed} />
        ) : (
          <p className="text-sm text-muted-foreground">Videos you open will show up here.</p>
        )}
      </section>
    </div>
  );
}
