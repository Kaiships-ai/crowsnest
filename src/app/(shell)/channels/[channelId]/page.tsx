import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { ChannelHeader } from "@/components/channels/channel-header";
import { ChannelVideoGrid } from "@/components/channels/channel-video-grid";
import { OutlierHistoryChart } from "@/components/channels/outlier-history-chart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCompact, formatMultiplier } from "@/lib/format";
import { getChannelDetail } from "@/server/queries/channels";
import { getVaultedVideoCounts } from "@/server/queries/vault";

// Dataviz stat-tile contract (DESIGN.md §5): sentence-case label, semibold compact
// value. No delta/sparkline here — the chart below already covers trend (§2.3).
function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
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
  const templateCounts = await getVaultedVideoCounts();
  const vaultedVideos = detail.videos.filter((v) => templateCounts.has(v.videoId));

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-6 p-6">
      <Link href="/channels" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Channels
      </Link>

      <ChannelHeader channel={detail.channel} />

      <div className="grid grid-cols-4 gap-4">
        <StatTile label="Median views" value={formatCompact(detail.stats.medianViews)} />
        <StatTile label="Best multiplier" value={formatMultiplier(detail.stats.bestScore)} />
        <StatTile label="Outliers (30d)" value={String(detail.stats.outliers30d)} />
        <StatTile label="Videos tracked" value={String(detail.stats.videoCount)} />
      </div>

      <div className="flex flex-col gap-2">
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
