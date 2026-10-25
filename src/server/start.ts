import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { config } from "./config";
import { db } from "./db";
import { startOwnMeasureScheduler } from "./services/own-measure-scheduler";
import { startPublishScheduler } from "./services/publish-scheduler";
import { startSyncScheduler } from "./services/sync-scheduler";

export { handleMcpRequest } from "./mcp/http";
export { GET as getMedia, HEAD as headMedia } from "../app/api/media/[assetId]/route";

const JOBS = [startPublishScheduler, startSyncScheduler, startOwnMeasureScheduler];

/** Starts the publish, sync and own-measure schedulers. A job that fails to start is
 *  logged and skipped, so it never stops its host from serving. */
export function startJobs(): () => void {
  const stops = JOBS.map((start) => {
    try {
      return start();
    } catch (err) {
      console.error(`${start.name} failed on boot:`, err);
      return () => {};
    }
  });
  return () => stops.forEach((stop) => stop());
}

const INSTAGRAM_HOSTS = new Set(["graph.instagram.com", new URL(config.IG_SERVICE_URL).host]);

/** Makes every fetch to the Graph API or the instagrapi sidecar fail, so a process that
 *  is not the primary writer cannot reach Instagram through a tool call. */
function refuseInstagram(): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (INSTAGRAM_HOSTS.has(new URL(url).host)) {
      return Promise.reject(new Error("Lead Studio is not the primary writer (LEAD_STUDIO_PRIMARY unset): Instagram is off"));
    }
    return realFetch(input, init);
  };
  return () => {
    globalThis.fetch = realFetch;
  };
}

/**
 * Lead Studio's server boot. Migrates the app's own DB copy, then either runs the jobs
 * (LEAD_STUDIO_PRIMARY=1) or leaves them to the :3000 server, which owns publishing
 * until the app takes over, and shuts Instagram off so nothing is published twice.
 */
export function startInApp({ migrationsFolder, env = process.env }: { migrationsFolder: string; env?: Record<string, string | undefined> }): () => void {
  migrate(db, { migrationsFolder });
  return env.LEAD_STUDIO_PRIMARY === "1" ? startJobs() : refuseInstagram();
}
