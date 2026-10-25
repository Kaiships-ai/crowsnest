import { graphClient } from "@/server/graph/client";
import type { Connector } from "../types";
import { instagramGraph } from "./manifest";

export const connector: Connector = {
  manifest: instagramGraph,
  adapter: {
    async testConnection() {
      const status = await graphClient.checkToken();
      return status.state === "ok" ? { ok: true, message: null } : { ok: false, message: status.message ?? status.state };
    },
  },
};
