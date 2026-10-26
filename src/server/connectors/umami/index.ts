import { clockNow } from "@/server/lib/clock";
import { readSecret } from "../secrets";
import type { Connector, ConnectorManifest } from "../types";
import { checkUmami, pullUmami, type UmamiAccess } from "./pull";

const umami = {
  id: "umami",
  label: "Umami",
  auth: "api-key",
  secrets: [
    { name: "UMAMI_URL", label: "Umami address" },
    { name: "UMAMI_WEBSITE_ID", label: "Website id" },
    { name: "UMAMI_USERNAME", label: "Username" },
    { name: "UMAMI_PASSWORD", label: "Password" },
  ],
  feeds: ["gift_page_visit", "email"],
} as const satisfies ConnectorManifest;

const MISSING = "Umami address, website id, username or password is missing";

function access(): UmamiAccess | null {
  const [url, websiteId, username, password] = umami.secrets.map((s) => readSecret(umami, s.name));
  return url && websiteId && username && password ? { url, websiteId, username, password } : null;
}

export const connector: Connector = {
  manifest: umami,
  adapter: {
    async testConnection() {
      const a = access();
      if (!a) return { ok: false, message: MISSING };
      try {
        await checkUmami(a);
        return { ok: true, message: null };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Umami check failed" };
      }
    },
    async pull() {
      const a = access();
      if (!a) return { kind: "failed", reason: MISSING };
      return pullUmami(a, clockNow());
    },
  },
};
