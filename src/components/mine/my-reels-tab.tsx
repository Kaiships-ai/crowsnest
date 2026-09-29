import { AccountAudience } from "./account-audience";
import { GraphConnectPanel } from "./graph-connect-panel";
import { OwnPostList, ReachByPostBars } from "./reach-by-post-bars";
import { OwnStatTiles } from "./own-stat-tiles";
import { OwnWeekdayRhythm } from "./own-weekday-rhythm";
import { ReelInsightPanel } from "./reel-insight-panel";
import { ReelPicker } from "./reel-picker";
import { ownChannelPicker } from "./calendar-tab";
import { relativeTime } from "@/lib/format";
import { cachedTokenStatus } from "@/server/graph/token-status";
import { getOwnChannel } from "@/server/queries/channels";
import { getAccountBreakdowns, getOwnChannelOverview, getOwnPosts, getOwnReels, getReelViewHistory } from "@/server/queries/own-channel";
import { selectReel, shapeReelInsights, typicalViewsCurve } from "@/server/services/reel-insights";
import { getSetting } from "@/server/settings";

/**
 * My reels. Two gates, neither faked: no own channel shows the picker; a token that is
 * missing or failing shows the connect panel, stacked over real historical numbers when
 * the account was measured before.
 */
export async function MyReelsTab({ reel }: { reel?: string }) {
  const ownChannel = await getOwnChannel();
  if (!ownChannel) return ownChannelPicker();

  const [tokenStatus, overview, ownPosts, minUsablePosts, reels, history, breakdowns] = await Promise.all([
    // Cached for five minutes so a reel picker click does not call Graph.
    cachedTokenStatus().catch((err: unknown) => ({
      configured: false, username: null, state: "unknown" as const, message: err instanceof Error ? err.message : String(err), checkedAt: new Date().toISOString(),
    })),
    getOwnChannelOverview(),
    getOwnPosts({ limit: 100 }),
    getSetting("scoreMinUsablePosts"),
    getOwnReels(),
    getReelViewHistory(),
    getAccountBreakdowns(),
  ]);
  const selected = selectReel(reels, reel);
  const insights = selected?.latest ? shapeReelInsights(selected.latest) : null;
  // Shape on the server; only the selected reel's points cross to the client chart.
  const points = selected ? typicalViewsCurve(selected.ownPostId, history) : [];
  const everMeasured = overview.account !== null;
  const connected = tokenStatus.state === "ok" && everMeasured;
  const panelOnly = !tokenStatus.configured || (!connected && !everMeasured);
  const progressPct = Math.min(100, (ownPosts.total / Math.max(1, minUsablePosts)) * 100);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-baseline justify-between gap-6">
        {/* h2: the Topbar owns the page h1; this names WHICH channel is yours. */}
        <h2 className="text-2xl font-bold tracking-[-0.015em]">{ownChannel.handle}</h2>
        <span className="font-mono text-2xs tracking-wide text-muted-foreground">
          {everMeasured ? `Graph API · synced ${relativeTime(overview.account!.measuredAt!)}` : "Graph API · not yet measured"}
          {ownChannel.followerCount !== null && ` · ${ownChannel.followerCount.toLocaleString("en-US")} followers`}
        </span>
      </div>
      {/* A token that fails now and a channel measured before are different facts, so the
          two states stack: real numbers whenever they exist, the problem named on top. */}
      {panelOnly ? (
        <GraphConnectPanel ownHandle={ownChannel.handle} initialStatus={tokenStatus} everMeasured={everMeasured} />
      ) : (
        <div className="flex flex-col gap-6">
          {!connected && <GraphConnectPanel ownHandle={ownChannel.handle} initialStatus={tokenStatus} everMeasured={everMeasured} />}
          <OwnStatTiles overview={overview} />
          <div className="flex items-center gap-4">
            <div className="h-px max-w-[460px] flex-1 bg-border">
              <div className="h-px bg-muted-foreground" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="whitespace-nowrap font-mono text-2xs text-muted-foreground">
              {overview.medianReach !== null
                ? `median active, based on the last ${overview.medianSampleSize} measured posts`
                : `${ownPosts.total} / ${minUsablePosts} posts before a median reach appears`}
            </span>
          </div>
          <ReachByPostBars posts={ownPosts.items} />
          <section className="grid gap-8 lg:grid-cols-[minmax(260px,320px)_1fr]">
            <ReelPicker
              reels={reels.map((r) => ({ ownPostId: r.ownPostId, postedAt: r.postedAt, views: r.latest?.views ?? null, thumbnailUrl: r.thumbnailUrl, caption: r.caption }))}
              selectedId={selected?.ownPostId ?? null}
            />
            {selected && (insights ? (
              <ReelInsightPanel insights={insights} points={points} />
            ) : (
              <p className="text-sm text-muted-foreground">This reel has not been measured yet.</p>
            ))}
          </section>
          <AccountAudience data={breakdowns} />
        </div>
      )}
      <section className="flex flex-col gap-4">
        <h3 className="text-lg font-medium">Posts</h3>
        <OwnPostList posts={ownPosts.items} />
      </section>
      <section className="flex flex-col gap-4">
        <h3 className="text-lg font-medium">Average reach by weekday</h3>
        <OwnWeekdayRhythm posts={ownPosts.items} />
      </section>
    </div>
  );
}
