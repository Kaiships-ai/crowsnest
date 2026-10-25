import { igClient } from "@/server/ig/client";
import type { Connector } from "../types";
import { igSidecar } from "./manifest";

export const connector: Connector = {
  manifest: igSidecar,
  adapter: {
    async testConnection() {
      const health = await igClient.health();
      return health.loggedIn ? { ok: true, message: null } : { ok: false, message: health.canLogin ? "sidecar is logged out" : "no Instagram login saved" };
    },
  },
};
