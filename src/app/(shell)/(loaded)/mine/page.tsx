import { PageContainer } from "@/components/layout/page-container";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GraphConnectPanel } from "@/components/mine/graph-connect-panel";
import { MineCalendar } from "@/components/mine/mine-calendar";
import { OwnChannelPicker } from "@/components/mine/own-channel-picker";
import { OwnPostList, ReachByPostBars } from "@/components/mine/reach-by-post-bars";
import { OwnStatTiles } from "@/components/mine/own-stat-tiles";
import { OwnWeekdayRhythm } from "@/components/mine/own-weekday-rhythm";
import { relativeTime } from "@/lib/format";
import { checkGraphTokenAction } from "@/server/actions/graph-actions";
import { isGraphConfigured } from "@/server/graph/client";
import { getStorageProvider } from "@/server/publish/storage-provider";
import { getChannelsList, getOwnChannel } from "@/server/queries/channels";
import { getCalendarMonth } from "@/server/queries/planned-posts";
import { getOwnChannelOverview, getOwnPosts } from "@/server/queries/own-channel";
import { getScripts } from "@/server/queries/vault";
import { getSetting } from "@/server/settings";

/**
 * My channel (v1-scope.md §1 "My channel" + "Planner"). The biggest hole in the
 * product before this: no /mine route existed at all. Two independent gates decide what
 * this screen can show, and neither is faked when it's missing:
 *
 * 1. Has Kai marked a channel as his own at all? `channels.is_own` — nothing here until
 *    he says so (`OwnChannelPicker`).
 * 2. Is the Instagram Graph API actually reachable right now, and has it ever measured
 *    anything? On this machine, today, the answer to both is no — there is no
 *    `IG_GRAPH_TOKEN` configured. `GraphConnectPanel` is what that renders as: not a
 *    loading spinner, not zeros, a plain statement of what's missing and what
 *    connecting would produce.
 *
 * The planner (the calendar, further down) depends on neither: `planned_posts` needs no
 * Graph connection, so it renders regardless. Only the "published" and "dead air" calendar
 * states, which need a real own-channel measurement to mean anything, stay off until one
 * exists — see MineCalendar's doc comment.
 */

const MONTH_RE = /^\d{4}-\d{2}$/;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default async function MinePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: monthParam } = await searchParams;
  const month = monthParam && MONTH_RE.test(monthParam) ? monthParam : currentMonth();

  const ownChannel = await getOwnChannel();

  if (!ownChannel) {
    const channels = await getChannelsList();
    const candidates = channels
      .filter((c) => !c.isOwn)
      .map((c) => ({ id: c.id, handle: c.handle, displayName: c.displayName, followerCount: c.followerCount }));
    return <OwnChannelPicker candidates={candidates} />;
  }

  const [tokenResult, overview, ownPosts, scripts, minUsablePosts, calendar] = await Promise.all([
    checkGraphTokenAction(),
    getOwnChannelOverview(),
    getOwnPosts({ limit: 100 }),
    getScripts(),
    getSetting("scoreMinUsablePosts"),
    getCalendarMonth(month),
  ]);

  const tokenStatus = tokenResult.ok
    ? tokenResult.status
    : ({ configured: false, username: null, state: "unknown" as const, message: tokenResult.error, checkedAt: new Date().toISOString() });

  const everMeasured = overview.account !== null;
  const connected = tokenStatus.state === "ok" && everMeasured;
  const scriptOptions = scripts.map((s) => ({ id: s.id, title: s.title }));

  const totalPosts = ownPosts.total;
  const progressPct = Math.min(100, (totalPosts / Math.max(1, minUsablePosts)) * 100);

  // Publish honesty: the calendar's publish dialog only offers a real publish when both
  // seams are configured, and never fabricates success (plan locked decision 6).
  const bucketConfigured = getStorageProvider() !== null;
  const graphConfigured = isGraphConfigured();
  // Mirrors envDefaultsDryRun() in publish-post.ts (which owns the per-row decision): dry
  // run is the safe default off production, so the dialog can warn the final POST is
  // skipped. ponytail: one small duplicated predicate rather than widening publish-post's
  // API just to read a boolean.
  const publishDryRun = process.env.PUBLISH_DRY_RUN === "1" || (process.env.PUBLISH_DRY_RUN === undefined && process.env.NODE_ENV !== "production");

  return (
    <PageContainer className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-6">
        {/* h2, not h1: Topbar already renders this route's h1 ("My channel") — see
            nav-items/topbar's ROUTE_TITLES. Unlike /logs and /runs this line is not a
            repeat of that title, it names WHICH channel is yours, so it stays on screen
            (same classes, same look) and stays a heading, one level down. */}
        <h2 className="text-2xl font-bold tracking-[-0.015em]">{ownChannel.handle}</h2>
        <span className="font-mono text-2xs tracking-wide text-muted-foreground">
          {everMeasured ? `Graph API · synced ${relativeTime(overview.account!.measuredAt!)}` : "Graph API · not yet measured"}
          {ownChannel.followerCount !== null && ` · ${ownChannel.followerCount.toLocaleString("en-US")} followers`}
        </span>
      </div>

      {/* A token that currently fails and a channel that was measured before are not
          the same fact. Hiding real historical figures because the live check failed
          just now would be its own kind of dishonesty. So the two states stack instead
          of replacing each other: real numbers whenever they exist, the connection
          problem named on top of them whenever there is one. */}
      {!tokenStatus.configured || (!connected && !everMeasured) ? (
        <GraphConnectPanel ownHandle={ownChannel.handle} initialStatus={tokenStatus} everMeasured={everMeasured} />
      ) : (
        <>
          {!connected && <GraphConnectPanel ownHandle={ownChannel.handle} initialStatus={tokenStatus} everMeasured={everMeasured} />}

          <div className="mt-4">
            <OwnStatTiles overview={overview} />
          </div>

          <div className="mt-8 flex items-center gap-4">
            <div className="h-px max-w-[460px] flex-1 bg-border">
              <div className="h-px bg-muted-foreground" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="whitespace-nowrap font-mono text-2xs text-muted-foreground">
              {overview.medianReach !== null
                ? `median active, based on the last ${overview.medianSampleSize} measured posts`
                : `${totalPosts} / ${minUsablePosts} posts before a median reach appears`}
            </span>
          </div>

          <div className="mt-6">
            <ReachByPostBars posts={ownPosts.items} />
          </div>
        </>
      )}

      <div className="mt-10 border-t border-border pt-10">
        <Tabs defaultValue="month">
          <TabsList className="rounded-full bg-popover p-1">
            <TabsTrigger value="month" className="rounded-full">
              Month
            </TabsTrigger>
            <TabsTrigger value="posts" className="rounded-full">
              Posts
            </TabsTrigger>
            <TabsTrigger value="metrics" className="rounded-full">
              Metrics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="month" className="mt-6">
            <MineCalendar
              month={month}
              calendar={calendar}
              scripts={scriptOptions}
              graphConfigured={graphConfigured}
              bucketConfigured={bucketConfigured}
              dryRun={publishDryRun}
            />
          </TabsContent>

          <TabsContent value="posts" className="mt-6">
            <OwnPostList posts={ownPosts.items} />
          </TabsContent>

          <TabsContent value="metrics" className="mt-6">
            <OwnWeekdayRhythm posts={ownPosts.items} />
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}
