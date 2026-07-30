import { AddChannelDialog } from "@/components/channels/add-channel-dialog";
import { ChannelTable } from "@/components/channels/channel-table";
import { FleetRail } from "@/components/channels/fleet-rail";
import { getChannelsList, getFleets } from "@/server/queries/channels";

type SearchParams = Record<string, string | string[] | undefined>;

// Topbar already renders this route's h1 ("Channels") — page content starts below it,
// no duplicate heading (M6).
export default async function ChannelsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const fleetRaw = sp.fleet;
  const fleetId = Array.isArray(fleetRaw) ? fleetRaw[0] : fleetRaw;

  const [fleets, allChannels, scopedChannels] = await Promise.all([
    getFleets(),
    getChannelsList(),
    fleetId ? getChannelsList(fleetId) : Promise.resolve(null),
  ]);
  const channels = scopedChannels ?? allChannels;

  const neverSynced = channels.filter((c) => c.lastSyncedAt === null).length;
  const summary =
    channels.length === 0
      ? "No channels tracked yet"
      : `${channels.length} channel${channels.length === 1 ? "" : "s"} tracked` +
        (neverSynced > 0 ? ` · ${neverSynced} never synced` : "");

  return (
    <div className="mx-auto flex h-full max-w-[1120px]">
      <FleetRail fleets={fleets} totalChannels={allChannels.length} />

      <div className="flex-1 overflow-y-auto py-4 pl-6">
        <div className="mb-10 flex items-baseline justify-between gap-6">
          <span className="font-mono text-2xs text-faint">{summary}</span>
          <AddChannelDialog />
        </div>
        <ChannelTable channels={channels} fleets={fleets} />
      </div>
    </div>
  );
}
