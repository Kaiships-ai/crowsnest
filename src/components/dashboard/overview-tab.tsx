import Link from "next/link";

import { ContentPipeline } from "@/components/dashboard/content-pipeline";
import { CoverageList } from "@/components/dashboard/coverage-list";
import { buildOutlierTimeline, buildProducerDonut, buildScatterPoints, rankingRows } from "@/components/dashboard/dashboard-chart-data";
import { FleetSpikeRow } from "@/components/dashboard/fleet-spike-row";
import { NextActionBar, decideNextAction } from "@/components/dashboard/next-action-bar";
import { OutlierScrollRow } from "@/components/dashboard/outlier-scroll-row";
import { OutlierTimeline } from "@/components/dashboard/outlier-timeline";
import { ProducerDonut } from "@/components/dashboard/producer-donut";
import { ReachScoreScatter } from "@/components/dashboard/reach-score-scatter";
import { ScoreRankingList } from "@/components/dashboard/score-ranking-list";
import { StatTile } from "@/components/dashboard/stat-tile";
import { StackHealthPanel } from "@/components/status/stack-health-panel";
import {
  classifyGraphStatus,
  classifySidecarStatus,
  PING_TIMEOUT_MS,
  withTimeout,
} from "@/components/status/dependency-status";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ItemGroup } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { getIgStatusAction } from "@/server/actions/ig-actions";
import { getChannelsList } from "@/server/queries/channels";
import {
  getDashboardStats,
  getFleetSpikes,
  getNewOutliersSince,
  getRecentlyViewed,
  getStackHealth,
  getTopOutliersToday,
  readAndBumpDashboardLastVisit,
} from "@/server/queries/dashboard";
import { getOutlierFeed } from "@/server/queries/feed";
import { getPlannedPosts } from "@/server/queries/planned-posts";
import { listArtifacts } from "@/server/services/artifacts";
import { cachedTokenStatus } from "@/server/graph/token-status";

// The Dashboard's Overview tab. Topbar already renders the route's h1 ("Dashboard") and
// DashboardPage renders the tab strip, so content here starts directly at the KPI row.
//
// v1-scope.md's P1 dashboard list, against what's here as of Wave 2:
//
// - Producer donut, reach-vs-score scatter, 28-day timeline, score ranking list,
//   coverage list: BUILT below, off `getOutlierFeed` (all channels, unfiltered) and
//   `getChannelsList` — both landed in Wave 1 and already the source of truth for the
//   Feed and Channels screens. Shaping lives in `dashboard-chart-data.ts` (dashboard/),
//   pure functions over data this page already fetched, not a new query. The top-post
//   hero and the empty states are the rest of that P1 line and were covered by the
//   truth pass — the top-outliers scroll row below stands in for the hero, kept from
//   the phase-4 structure rather than replaced, since v1-scope.md doesn't ask for a
//   second one.
// - Next action bar: BUILT (NextActionBar), but grounded in real state rather than the
//   prototype's session flags. It shows one recommendation decided by `decideNextAction`
//   from last-sync freshness and the new-since-visit count, and links only to routes that
//   exist. The prototype's five-destination "have you done X" bar is still not rebuilt:
//   two of its milestones have no persisted equivalent in this schema, so faking them
//   would be worse than the honest single recommendation shown here.
// - v0.3 dashboard is the content-machine workflow (next action, freshness, research
//   sources, outliers, content pipeline), with the P1 analytics charts kept but moved
//   below and labelled secondary.
export async function OverviewTab() {
  const [stats, topOutliers, fleetSpikes, recentlyViewed, allPosts, channels, igStatusResult, graphToken, stackHealth, pipelineArtifacts, plannedPosts] = await Promise.all([
    getDashboardStats(),
    getTopOutliersToday(),
    getFleetSpikes(),
    getRecentlyViewed(),
    // Unfiltered, every channel, live + removed — the five P1 charts below all read
    // off this one fetch (same "one query, several shapes" pattern `getChannelDetail`
    // already uses over the same function). 10,000 matches the ceiling
    // `getChannelDetail` already uses for "give me everything" — not a real cap on
    // how many posts this app will ever hold, just headroom past today's handful.
    getOutlierFeed({ sort: "score", limit: 10_000, offset: 0 }),
    getChannelsList(),
    // A4 (v1-to-product-backlog.html): the two out-of-process dependencies, checked
    // before Kai clicks anything. The sidecar check is the same `getIgStatusAction`
    // Settings already uses; Graph is the cached token check Settings' Graph section
    // shows. `withTimeout` keeps a dead network from stalling this page load.
    getIgStatusAction(),
    withTimeout(cachedTokenStatus(), PING_TIMEOUT_MS),
    // M4-U8: the two halves of stack health that come out of this app's own tables —
    // the last sync and anything still running — next to the two live pings above, so
    // all four read at once. Two indexed reads over `sync_jobs`/`frame_pass_jobs`, in
    // the same Promise.all rather than after it, so the panel costs no extra round trip.
    getStackHealth(),
    // Content pipeline: what the reasoning agent has persisted through MCP. Newest six for
    // the dashboard strip; the total count comes back in the same call.
    listArtifacts({ limit: 6 }),
    // Planned posts, for the pipeline's "planned" count. No range = all of them.
    getPlannedPosts(),
  ]);
  const allItems = allPosts.items;

  // Sequential, not part of the Promise.all above: the bump writes, so its result has to
  // be read before it is overwritten. Reading the previous value here is what makes the
  // strip below mean "since the load before this one".
  const lastVisit = await readAndBumpDashboardLastVisit();
  const newSinceVisit = await getNewOutliersSince(lastVisit);

  const sidecarStatus = classifySidecarStatus(igStatusResult);
  const graphStatus = classifyGraphStatus(graphToken);

  // The one next action, decided from state. Freshness is measured off the last finished
  // sync against `checkedAtMs` (a server-captured "now", so no clock is read in render).
  const lastSyncMs = stackHealth.lastSync?.finishedAt ? Date.parse(stackHealth.lastSync.finishedAt) : null;
  const nowMs = stackHealth.checkedAtMs;
  const nextAction = decideNextAction({ lastSyncMs, nowMs, newSinceVisit });

  // True-empty (DESIGN.md §6 spirit): zero channels tracked means every KPI would
  // read 0 and every section would be empty — one clear "get started" state instead
  // of four separate empty sub-states stacked on top of each other. It renders as the
  // shared `Empty` composition (headline, supporting line, one primary action), the
  // same shape every other whole-view empty in the app uses.
  if (stats.channelsTracked === 0) {
    return (
      <>
        <StackHealthPanel
          sidecar={sidecarStatus}
          graph={graphStatus}
          lastSync={stackHealth.lastSync}
          running={stackHealth.running}
          checkedAtMs={stackHealth.checkedAtMs}
        />
        <Empty className="pt-6 pb-24">
          <EmptyHeader>
            <EmptyTitle>No channels are being watched, so there is nothing to score.</EmptyTitle>
            <EmptyDescription>
              Add a channel and run a sync — medians take a few posts to settle before scores mean anything.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button render={<Link href="/channels" />}>Add a channel</Button>
          </EmptyContent>
        </Empty>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-16">
      {/* The decision surface first: the one next action, decided from state. */}
      <NextActionBar next={nextAction} />

      {/* 1. Data freshness and account health. */}
      <StackHealthPanel
        sidecar={sidecarStatus}
        graph={graphStatus}
        lastSync={stackHealth.lastSync}
        running={stackHealth.running}
        checkedAtMs={stackHealth.checkedAtMs}
      />

      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
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

      {/* 2. Selected research sources: the channels you plan from, and which fleets moved. */}
      <Card>
        <CardHeader>
          <CardTitle>Research sources</CardTitle>
          <CardAction>
            <Link href="/channels" className="text-xs text-muted-foreground hover:text-foreground">
              Manage channels →
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <p className="text-sm text-muted-foreground">
            <span className="font-mono text-foreground" data-num>
              {channels.length}
            </span>{" "}
            channel{channels.length === 1 ? "" : "s"} tracked as research sources.
            {fleetSpikes.length > 0 ? " Fleets with new spikes:" : " No fleets have new spikes this week."}
          </p>
          {fleetSpikes.length > 0 && (
            <ItemGroup>
              {fleetSpikes.map((spike) => (
                <FleetSpikeRow key={spike.fleetId} spike={spike} />
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>

      {/* 3. Highest-value outliers. */}
      <Card>
        <CardHeader>
          <CardTitle>Highest-value outliers</CardTitle>
          <CardAction>
            <Link href="/feed" className="text-xs text-muted-foreground hover:text-foreground">
              View all in Feed →
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {/* Honest new-since-visit count: no score history in this schema to diff, so no
              faked "movers" line. Hidden at zero. */}
          {newSinceVisit > 0 && (
            <Link href="/feed" className="flex items-center gap-2 text-sm text-foreground hover:underline">
              <span className="font-mono text-primary" data-num>
                {newSinceVisit}
              </span>
              new outlier{newSinceVisit === 1 ? "" : "s"} since your last visit
            </Link>
          )}
          {topOutliers.length > 0 ? (
            <OutlierScrollRow items={topOutliers} />
          ) : (
            <p className="text-sm text-muted-foreground">Analyze more videos to see patterns here.</p>
          )}
        </CardContent>
      </Card>

      {/* 4. Current content pipeline: what the agent has persisted through MCP. */}
      <ContentPipeline
        artifacts={pipelineArtifacts.items}
        artifactTotal={pipelineArtifacts.total}
        scriptsDrafted={stats.scriptsDrafted}
        plannedCount={plannedPosts.length}
        nowMs={nowMs}
      />

      <Card>
        <CardHeader>
          <CardTitle>Recently viewed</CardTitle>
        </CardHeader>
        <CardContent>
          {recentlyViewed.length > 0 ? (
            <OutlierScrollRow items={recentlyViewed} />
          ) : (
            <p className="text-sm text-muted-foreground">Videos you open will show up here.</p>
          )}
        </CardContent>
      </Card>

      {/* Analytics, deliberately last and labelled as secondary: the dashboard above is
          the content-machine workflow; these charts are supporting detail, not the point.
          Each renders its own honest empty state, so only the all-channels "nothing has
          synced" case is handled here. */}
      <section className="flex flex-col gap-8">
        <Separator />
        <h2 className="font-heading text-base font-medium text-foreground">Analytics</h2>
        {allItems.length > 0 ? (
          <>
            <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
              <ProducerDonut {...buildProducerDonut(allItems)} />
              <ReachScoreScatter {...buildScatterPoints(allItems)} />
            </div>
            <OutlierTimeline {...buildOutlierTimeline(allItems)} />
            <ScoreRankingList {...rankingRows(allItems)} />
            <CoverageList channels={channels} items={allItems} />
          </>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No posts have synced yet, so there is nothing to plot.</EmptyTitle>
              <EmptyDescription>
                Run a sync — medians need about ten posts before a score means anything.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </div>
  );
}
