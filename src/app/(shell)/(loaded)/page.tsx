import Link from "next/link";

import { ContentPipeline } from "@/components/dashboard/content-pipeline";
import { CoverageList } from "@/components/dashboard/coverage-list";
import { rankingRows } from "@/components/dashboard/dashboard-chart-data";
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
  classifyLlmStatus,
  classifySidecarStatus,
  LLM_PING_TIMEOUT_MS,
  withTimeout,
} from "@/components/status/dependency-status";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getIgStatusAction } from "@/server/actions/ig-actions";
import { testAnthropicKeyAction } from "@/server/actions/settings-actions";
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
import { hasLlmKey, isCompatMode } from "@/server/llm/client";

// Read once, server-side, same reasoning as the Remix screen's own `LLM_PROXY_URL`
// (`(shell)/feed/[videoId]/remix/page.tsx`): the one honest thing this app can say
// about the model backend's location, since it has no mechanism to start one itself.
const LLM_PROXY_URL = process.env.LLM_BASE_URL ?? null;

// Unlike every other route in this app, `/` has no searchParams and no dynamic route
// segment to implicitly opt it out of static rendering — without this, `next build`
// would prerender the KPIs/outliers/spikes once at build time and freeze them there,
// which is wrong for numbers meant to reflect the live local DB on every visit.
export const dynamic = "force-dynamic";

// Topbar already renders this route's h1 ("Dashboard") — see nav-items/topbar's
// ROUTE_TITLES — so page content here starts directly at the KPI row.
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
export default async function DashboardPage() {
  const llmKeyConfigured = hasLlmKey();
  const [stats, topOutliers, fleetSpikes, recentlyViewed, allPosts, channels, igStatusResult, llmPingResult, stackHealth, pipelineArtifacts, plannedPosts] = await Promise.all([
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
    // Settings already uses. The LLM check only runs when a key exists — no key means
    // no client to ping, and `withTimeout` keeps a fully dead backend from stalling
    // this page load (see dependency-status.ts's own doc on why that matters here).
    getIgStatusAction(),
    llmKeyConfigured ? withTimeout(testAnthropicKeyAction(), LLM_PING_TIMEOUT_MS) : Promise.resolve(undefined),
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
  const llmStatus = classifyLlmStatus({
    hasKey: llmKeyConfigured,
    proxyUrl: LLM_PROXY_URL,
    routedThroughProxy: isCompatMode(),
    ping: llmPingResult ?? "timed_out",
  });

  // The one next action, decided from state. Freshness is measured off the last finished
  // sync against `checkedAtMs` (a server-captured "now", so no clock is read in render).
  const lastSyncMs = stackHealth.lastSync?.finishedAt ? Date.parse(stackHealth.lastSync.finishedAt) : null;
  const nowMs = stackHealth.checkedAtMs;
  const nextAction = decideNextAction({ lastSyncMs, nowMs, newSinceVisit });

  // True-empty (DESIGN.md §6 spirit): zero channels tracked means every KPI would
  // read 0 and every section would be empty — one clear "get started" state instead
  // of four separate empty sub-states stacked on top of each other. Left-aligned
  // headline + supporting line + primary button, max-width 48ch, matches the
  // prototype's own `noPosts` empty state (`dashboard` screen, line 386) rather
  // than the centered single line this used to be.
  if (stats.channelsTracked === 0) {
    return (
      <div className="mx-auto max-w-[1120px] p-6">
        <StackHealthPanel
          sidecar={sidecarStatus}
          llm={llmStatus}
          hasLlmKey={llmKeyConfigured}
          lastSync={stackHealth.lastSync}
          running={stackHealth.running}
          checkedAtMs={stackHealth.checkedAtMs}
        />
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
    <div className="mx-auto flex max-w-[1120px] flex-col gap-16 p-6">
      {/* The decision surface first: the one next action, decided from state. */}
      <NextActionBar next={nextAction} />

      {/* 1. Data freshness and account health. */}
      <StackHealthPanel
        sidecar={sidecarStatus}
        llm={llmStatus}
        hasLlmKey={llmKeyConfigured}
        lastSync={stackHealth.lastSync}
        running={stackHealth.running}
        checkedAtMs={stackHealth.checkedAtMs}
      />

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

      {/* 2. Selected research sources: the channels you plan from, and which fleets moved. */}
      <section className="flex flex-col gap-6">
        <div className="flex items-baseline justify-between gap-6">
          <span data-lab className="font-mono text-2xs text-faint">
            Research sources
          </span>
          <Link href="/channels" className="text-xs text-muted-foreground hover:text-foreground">
            Manage channels →
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono text-foreground" data-num>
            {channels.length}
          </span>{" "}
          channel{channels.length === 1 ? "" : "s"} tracked as research sources.
          {fleetSpikes.length > 0 ? " Fleets with new spikes:" : " No fleets have new spikes this week."}
        </p>
        {fleetSpikes.length > 0 && (
          <div className="flex flex-col divide-y divide-border border border-border">
            {fleetSpikes.map((spike) => (
              <FleetSpikeRow key={spike.fleetId} spike={spike} />
            ))}
          </div>
        )}
      </section>

      {/* 3. Highest-value outliers. */}
      <section className="flex flex-col gap-6">
        <div className="flex items-baseline justify-between gap-6">
          <span data-lab className="font-mono text-2xs text-faint">
            Highest-value outliers
          </span>
          <Link href="/feed" className="text-xs text-muted-foreground hover:text-foreground">
            View all in Feed →
          </Link>
        </div>
        {/* Honest new-since-visit count: no score history in this schema to diff, so no
            faked "movers" line. Hidden at zero. */}
        {newSinceVisit > 0 && (
          <Link href="/feed" className="flex items-center gap-2 text-sm text-foreground hover:underline">
            <span className="font-mono text-score" data-num>
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
      </section>

      {/* 4. Current content pipeline: what the agent has persisted through MCP. */}
      <ContentPipeline
        artifacts={pipelineArtifacts.items}
        artifactTotal={pipelineArtifacts.total}
        scriptsDrafted={stats.scriptsDrafted}
        plannedCount={plannedPosts.length}
        nowMs={nowMs}
      />

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

      {/* Analytics, deliberately last and labelled as secondary: the dashboard above is
          the content-machine workflow; these charts are supporting detail, not the point.
          Each renders its own honest empty state, so only the all-channels "nothing has
          synced" case is handled here. */}
      <section className="flex flex-col gap-8 border-t border-border pt-10">
        <span data-lab className="font-mono text-2xs text-faint">
          Analytics
        </span>
        {allItems.length > 0 ? (
          <>
            <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
              <ProducerDonut items={allItems} />
              <ReachScoreScatter items={allItems} />
            </div>
            <OutlierTimeline items={allItems} />
            <ScoreRankingList {...rankingRows(allItems)} />
            <CoverageList channels={channels} items={allItems} />
          </>
        ) : (
          <p className="max-w-[56ch] text-sm text-muted-foreground">
            No posts have synced yet, so there is nothing to plot. Run a sync — medians need about ten posts before a
            score means anything.
          </p>
        )}
      </section>
    </div>
  );
}
