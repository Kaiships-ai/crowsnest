import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./db";
import { log } from "./lib/logger";
import { migrateSecretsToKeychain } from "./secrets/store";
import { startDailyPullScheduler } from "./services/daily-pull";
import { startOwnMeasureScheduler } from "./services/own-measure-scheduler";
import { startPublishScheduler } from "./services/publish-scheduler";
import { startSyncScheduler } from "./services/sync-scheduler";

export { dispatchEngineCall } from "./bridge/engine-calls";
export { handleMcpRequest } from "./mcp/http";
export { rotateLocalMcpToken } from "./services/mcp-tokens";
export { GET as getMedia, HEAD as headMedia } from "./media/serve";

const READ_JOBS = [startSyncScheduler, startOwnMeasureScheduler, startDailyPullScheduler];
const ALL_JOBS = [startPublishScheduler, ...READ_JOBS];

export function startJobs(jobs = ALL_JOBS): () => void {
  const stops = jobs.map((start) => {
    try {
      return start();
    } catch (err) {
      console.error(`${start.name} failed on boot:`, err);
      return () => {};
    }
  });
  return () => stops.forEach((stop) => stop());
}

export function startInApp({ migrationsFolder, env = process.env }: { migrationsFolder: string; env?: Record<string, string | undefined> }): () => void {
  migrate(db, { migrationsFolder });
  const secrets = migrateSecretsToKeychain();
  if (secrets.moved.length) log.info("secrets.moved_to_keychain", { names: secrets.moved });
  for (const { name, reason } of secrets.failed) log.warn("secrets.keychain_move_failed", { name, reason });
  return startJobs(env.LEAD_STUDIO_PUBLISH_JOBS === "1" ? ALL_JOBS : READ_JOBS);
}
