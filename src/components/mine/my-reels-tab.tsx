import { GraphConnectPanel } from "./graph-connect-panel";
import { OwnPostList, ReachByPostBars } from "./reach-by-post-bars";
import { OwnStatTiles } from "./own-stat-tiles";
import { OwnWeekdayRhythm } from "./own-weekday-rhythm";
import { ownChannelPicker } from "./calendar-tab";
import { relativeTime } from "@/lib/format";
import { checkGraphTokenAction } from "@/server/actions/graph-actions";
import { getOwnChannel } from "@/server/queries/channels";
import { getOwnChannelOverview, getOwnPosts } from "@/server/queries/own-channel";
import { getSetting } from "@/server/settings";

/**
 * My reels. Two gates, neither faked: no own channel shows the picker; a token that is
 * missing or failing shows the connect panel, stacked over real historical numbers when
 * the account was measured before.
 */
export async function MyReelsTab() {
  const ownChannel = await getOwnChannel();
  if (!ownChannel) return ownChannelPicker();

  const [tokenResult, overview, ownPosts, minUsablePosts] = await Promise.all([
    checkGraphTokenAction(),
    getOwnChannelOverview(),
    getOwnPosts({ limit: 100 }),
    getSetting("scoreMinUsablePosts"),
  ]);
  const tokenStatus = tokenResult.ok
    ? tokenResult.status
    : { configured: false, username: null, state: "unknown" as const, message: tokenResult.error, checkedAt: new Date().toISOString() };
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
