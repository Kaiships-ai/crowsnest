import { graphClient } from "@/server/graph/client";
import { clockNow } from "@/server/lib/clock";
import type { PullResult } from "@/server/lib/pull-result";
import { measureOwnChannel, type MeasureResult } from "@/server/services/own-measure";
import type { Connector } from "../types";
import { instagramGraph } from "./manifest";

/** Maps a measurement to a pull outcome. */
export function measurePull(r: MeasureResult): PullResult<MeasureResult, unknown> {
  if (!r.ok) return { kind: "failed", reason: r.error };
  if (r.stoppedEarly) return { kind: "partial", rows: r, missing: "posts left after the run stopped", reason: r.stoppedEarly === "budget" ? "hourly call budget" : "rate limited" };
  if (r.postsFailed > 0) return { kind: "partial", rows: r, missing: `insights for ${r.postsFailed} of ${r.postsSeen} posts`, reason: "a call failed" };
  if (r.partial) return { kind: "partial", rows: r, missing: "comments or breakdowns", reason: "a call failed" };
  return { kind: "complete", rows: r };
}

export const connector: Connector = {
  manifest: instagramGraph,
  adapter: {
    async testConnection() {
      const status = await graphClient.checkToken();
      return status.state === "ok" ? { ok: true, message: null } : { ok: false, message: status.message ?? status.state };
    },
    async pull() {
      return measurePull(await measureOwnChannel({ scope: "due", now: clockNow(), wait: true }));
    },
  },
};
