import { graphClient } from "@/server/graph/client";
import { clockNow } from "@/server/lib/clock";
import type { PullResult } from "@/server/lib/pull-result";
import { measureOwnChannel, type MeasureResult } from "@/server/services/own-measure";
import type { Connector } from "../types";
import { instagramGraph } from "./manifest";

/** What the card and the token form say when Graph refuses the token (code 190, an expired or revoked token). */
export const TOKEN_REJECTED = "Instagram rejected the token (expired). Get a new token and paste it.";
export const TOKEN_REJECTED_FORM = "Instagram rejected this token. Copy a new one and paste it again.";

/** Maps a measurement to a pull outcome. */
export function measurePull(r: MeasureResult): PullResult<MeasureResult, unknown> {
  if (!r.ok) return { kind: "failed", reason: r.code === "GRAPH_AUTH_FAILED" ? TOKEN_REJECTED : r.error };
  if (r.stoppedEarly) return { kind: "partial", rows: r, missing: "posts left after the run stopped", reason: r.stoppedEarly === "budget" ? "hourly call budget" : r.stoppedEarly === "stopped" ? "stopped" : "rate limited" };
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
    /** Test connection on the card: /me with the saved token, shown as the handle. */
    async sample() {
      const status = await graphClient.checkToken();
      if (status.state === "ok") return { ok: true, line: `@${status.username ?? "?"}` };
      return { ok: false, message: status.state === "auth_failed" ? TOKEN_REJECTED : (status.message ?? status.state), retryAfter: null };
    },
    async pull() {
      return measurePull(await measureOwnChannel({ scope: "due", now: clockNow(), wait: true }));
    },
  },
};
