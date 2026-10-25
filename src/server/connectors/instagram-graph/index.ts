import { graphClient } from "@/server/graph/client";
import { clockNow } from "@/server/lib/clock";
import { measureOwnChannel } from "@/server/services/own-measure";
import type { Connector } from "../types";
import { instagramGraph } from "./manifest";

export const connector: Connector = {
  manifest: instagramGraph,
  adapter: {
    async testConnection() {
      const status = await graphClient.checkToken();
      return status.state === "ok" ? { ok: true, message: null } : { ok: false, message: status.message ?? status.state };
    },
    async pull() {
      const r = await measureOwnChannel({ scope: "due", now: clockNow(), wait: true });
      if (!r.ok) return { kind: "failed", reason: r.error };
      if (r.stoppedEarly) return { kind: "partial", rows: r, missing: "posts left after the run stopped", reason: r.stoppedEarly === "budget" ? "hourly call budget" : "rate limited" };
      if (r.partial) return { kind: "partial", rows: r, missing: "comments or breakdowns", reason: "a call failed" };
      return { kind: "complete", rows: r };
    },
  },
};
