import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./db";
import { startOwnMeasureScheduler } from "./services/own-measure-scheduler";
import { startPublishScheduler } from "./services/publish-scheduler";
import { startSyncScheduler } from "./services/sync-scheduler";

export { handleMcpRequest } from "./mcp/http";
export { GET as getMedia, HEAD as headMedia } from "./media/serve";

const READ_JOBS = [startSyncScheduler, startOwnMeasureScheduler];

/** Starts the given schedulers, by default publish, sync and own-measure. A job that fails
 *  to start is logged and skipped, so it never stops its host from serving. */
export function startJobs(jobs = [startPublishScheduler, ...READ_JOBS]): () => void {
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

/**
 * Lead Studio's server boot. Migrates the DB, then starts sync and own-measure. The publish
 * scheduler starts only with LEAD_STUDIO_PUBLISH_JOBS=1, so the app never auto-publishes
 * until the publish step ships.
 */
export function startInApp({ migrationsFolder, env = process.env }: { migrationsFolder: string; env?: Record<string, string | undefined> }): () => void {
  migrate(db, { migrationsFolder });
  return startJobs(env.LEAD_STUDIO_PUBLISH_JOBS === "1" ? undefined : READ_JOBS);
}
