import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { ChannelHeader } from "@/components/channels/channel-header";
import { ChannelPostCalendar } from "@/components/channels/channel-post-calendar";
import { ChannelVideoGrid } from "@/components/channels/channel-video-grid";
import { OutlierHistoryChart, ReachByPostBars } from "@/components/channels/outlier-history-chart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCompact, formatMultiplier } from "@/lib/format";
import { getChannelDetail, getChannelMedianBasis } from "@/server/queries/channels";
import { getVaultedVideoCounts } from "@/server/queries/vault";
import { getSetting } from "@/server/settings";
import { MEDIAN_CONFIDENCE_THRESHOLDS, medianConfidence } from "@/server/services/outlier-calc";

// Dataviz stat-tile contract, restyled to the "mine" prototype's big mono numeral —
// every figure keeps its own sample-size caption underneath (own-channel figures
// carry their sample size), and a null value is a dash, never a fabricated zero.
function StatTile({
  value,
  label,
  sub,
  tone = "foreground",
}: {
  value: string;
  label: string;
  sub: string;
  tone?: "foreground" | "score";
}) {
  return (
    <div>
      <span
        data-num
        className={`block font-mono text-xl leading-none tracking-tight ${tone === "score" ? "text-score" : "text-foreground"}`}
      >
        {value}
      </span>
      <span className="mt-3 block max-w-[19ch] text-sm text-muted-foreground">{label}</span>
      <span className="mt-1 block font-mono text-2xs text-faint">{sub}</span>
    </div>
  );
}

// Topbar renders a static "Channel Detail" h1 for this route (phase-1's topbar
// doesn't do dynamic breadcrumbs) — page content starts at h2 (M6). DESIGN.md §2.3's
// "← Channels" back-link lives here in page content instead, since it's specific to
// this page rather than a topbar-wide concern.
export default async function ChannelDetailPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const detail = await getChannelDetail(channelId);
  if (!detail) notFound();

  const outliersOnly = detail.videos.filter((v) => v.outlierScore !== null && v.outlierScore >= 2);
  // scoreMinUsablePosts is a real, editable setting (Settings, Wave 1) — reading it here
  // instead of a hardcoded literal is the only way this page's wording can't drift the
  // moment someone changes the setting.
  const [templateCounts, minUsablePosts, medianBasis] = await Promise.all([
    getVaultedVideoCounts(),
    getSetting("scoreMinUsablePosts"),
    getChannelMedianBasis(channelId),
  ]);
  const vaultedVideos = detail.videos.filter((v) => templateCounts.has(v.videoId));

  // How many posts actually feed the median right now — the real gate from
  // outlier-calc.ts, worded honestly instead of the prototype's fixed "8/30" flavor
  // text (which belongs to a report gate that doesn't exist in this app yet).
  const usableForScore = Math.min(detail.videos.filter((v) => v.viewCount !== null).length, 20);
  const scoreGateMet = detail.stats.medianViews !== null;

  // Thin-sample note (v1-scope.md §2 Channels AC4): same medianConfidence/
  // MEDIAN_CONFIDENCE_THRESHOLDS the channels list note reads, so the two screens can
  // never quietly disagree about what "thin" means. This is a separate concept from
  // the score gate above — minUsablePosts decides whether a score shows at all, this
  // decides whether an already-showing score is still built on a thin sample.
  const sampleSize = medianBasis?.sampleSize ?? 0;
  const isThin = sampleSize > 0 && medianConfidence(sampleSize) === "low";

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-6 p-6">
      <Link href="/channels" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Channels
      </Link>

      <ChannelHeader channel={detail.channel} postCount={detail.stats.videoCount} />

      <div className="mt-10 grid grid-cols-2 gap-x-14 gap-y-10 sm:grid-cols-4">
        <StatTile
          value={formatCompact(detail.stats.medianViews)}
          label="Median views"
          sub={detail.stats.medianViews === null ? `needs ${minUsablePosts}+ measured posts` : `of ${usableForScore} posts`}
        />
        <StatTile
          value={formatMultiplier(detail.stats.bestScore)}
          label="Best score"
          sub={`of ${detail.stats.videoCount} posts`}
          tone="score"
        />
        <StatTile value={String(detail.stats.outliers30d)} label="Outliers, 30d" sub={`of ${detail.stats.videoCount} posts`} />
        {/* videoCount is live posts only; removedCount is how many more Instagram has since
            taken down (getChannelDetail's doc comment). Saying only videoCount here used to
            read as "these are all the posts", which stopped being true the moment a post got
            removed — the sub-label now says so instead of the old, now-inaccurate
            "all synced posts". */}
        <StatTile
          value={String(detail.stats.videoCount)}
          label="Posts tracked"
          sub={detail.stats.removedCount > 0 ? `${detail.stats.removedCount} more removed, not counted` : "none removed"}
        />
      </div>

      {isThin && (
        <p className="max-w-[52ch] text-sm text-muted-foreground">
          Only {sampleSize} post{sampleSize === 1 ? "" : "s"} behind this median — a median needs about{" "}
          {MEDIAN_CONFIDENCE_THRESHOLDS.low} before its scores mean anything.
        </p>
      )}

      <div className="flex items-center gap-4">
        <div className="h-px max-w-[460px] flex-1 bg-border">
          <div
            className="h-px bg-muted-foreground"
            style={{ width: scoreGateMet ? "100%" : `${Math.min(100, (usableForScore / minUsablePosts) * 100)}%` }}
          />
        </div>
        <span className="whitespace-nowrap font-mono text-2xs text-faint">
          {scoreGateMet
            ? `score active, based on the last ${usableForScore} posts`
            : `${usableForScore} / ${minUsablePosts} posts before a score appears`}
        </span>
      </div>

      <div className="mt-4">
        <ReachByPostBars videos={detail.videos} />
      </div>

      <div className="mt-4 border-t border-border pt-10">
        <ChannelPostCalendar videos={detail.videos} />
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-10">
        <h2 className="text-base font-semibold">Outlier history</h2>
        <OutlierHistoryChart series={detail.series} />
      </div>

      <Tabs defaultValue="recent">
        <TabsList>
          <TabsTrigger value="recent">Recent Reels</TabsTrigger>
          <TabsTrigger value="outliers">Outliers Only</TabsTrigger>
          <TabsTrigger value="vault">In Vault</TabsTrigger>
        </TabsList>

        <TabsContent value="recent">
          <ChannelVideoGrid items={detail.videos} emptyLabel="No reels tracked yet." />
        </TabsContent>
        <TabsContent value="outliers">
          <ChannelVideoGrid items={outliersOnly} emptyLabel="No outliers (2x+) yet." />
        </TabsContent>
        <TabsContent value="vault">
          <ChannelVideoGrid
            items={vaultedVideos}
            emptyLabel="No templates saved from this channel yet."
            templateCounts={templateCounts}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
