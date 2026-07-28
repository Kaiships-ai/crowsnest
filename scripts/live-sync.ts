/**
 * Adds a channel (if untracked) and runs one real sync against the live sidecar.
 *
 * Used by scripts/verify-live.sh to produce the Gate 3 proofs that need a real
 * Instagram session. Deliberately thin: it calls the same `addChannel`/`runSync`
 * the app's Sync button calls, so what it proves is the real code path and not a
 * bespoke one written to look good.
 *
 * It never logs in. If the sidecar has no session, the sync fails with
 * IG_AUTH_REQUIRED and this exits non-zero — a blind login attempt from a script
 * is exactly the behaviour that gets Instagram accounts challenged.
 */
import { addChannel, runSync } from "@/server/services/sync-engine";

async function main(): Promise<number> {
  const handle = process.argv[2];
  if (!handle) {
    console.error("usage: tsx scripts/live-sync.ts @handle");
    return 2;
  }

  const { channelId } = await addChannel({ handle });
  console.log(`channel: ${handle} -> ${channelId}`);

  const started = Date.now();
  const result = await runSync({ channelIds: [channelId] });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(
    JSON.stringify(
      {
        jobId: result.jobId,
        seconds: Number(seconds),
        itemsSeen: result.itemsSeen,
        itemsCreated: result.itemsCreated,
        itemsUpdated: result.itemsUpdated,
        itemsFailed: result.itemsFailed,
        itemsDeleted: result.itemsDeleted,
        assetsDownloaded: result.assetsDownloaded,
        assetsFailed: result.assetsFailed,
        stopReason: result.stopReason,
        gaps: result.gaps,
      },
      null,
      2
    )
  );

  // A run where every channel failed is a failure, whatever the job row says.
  if (result.channelsSynced === 0) {
    console.error("no channel synced successfully — see gaps above");
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    process.exit(1);
  });
