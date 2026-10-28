import { clockNow } from "@/server/lib/clock";
import { readSecret } from "../secrets";
import type { Connector, ConnectorManifest } from "../types";
import { SourceDownError } from "@/server/lib/pull-result";
import { checkUmami, pullUmami, umamiBase, type UmamiAccess, type UmamiWebsite } from "./pull";

export const umami = {
  id: "umami",
  label: "Umami",
  auth: "api-key",
  secrets: [
    { name: "UMAMI_URL", label: "Umami address" },
    { name: "UMAMI_API_KEY", label: "API key" },
    // Not typed by hand: Test connection finds it, and Save stores the picked one.
    { name: "UMAMI_WEBSITE_ID", label: "Website" },
  ],
  feeds: ["gift_page_visit", "email", "checkout"],
} as const satisfies ConnectorManifest;

/** The login secrets an older build saved; Save in the key dialog clears them. */
export const LEGACY_UMAMI_SECRETS = ["UMAMI_USERNAME", "UMAMI_PASSWORD"] as const;

const MISSING = "Umami address, API key or website is missing. Connect Umami.";

export function umamiAccess(): UmamiAccess | null {
  const [url, apiKey, websiteId] = umami.secrets.map((s) => readSecret(umami, s.name));
  return url && apiKey && websiteId ? { url, apiKey, websiteId } : null;
}

/** The card's line for a website: its domain and the Umami host. */
export const websiteLine = (website: UmamiWebsite, url: string): string => `${website.domain || website.name} · ${new URL(umamiBase(url)).host}`;

const failure = (err: unknown) => (err instanceof Error ? err.message : "Umami check failed");

export const connector: Connector = {
  manifest: umami,
  adapter: {
    async testConnection() {
      const a = umamiAccess();
      if (!a) return { ok: false, message: MISSING };
      try {
        await checkUmami(a);
        return { ok: true, message: null };
      } catch (err) {
        return { ok: false, message: failure(err) };
      }
    },
    async sample() {
      const a = umamiAccess();
      if (!a) return { ok: false, message: MISSING, retryAfter: null };
      try {
        return { ok: true, line: websiteLine(await checkUmami(a), a.url) };
      } catch (err) {
        return { ok: false, message: failure(err), retryAfter: null, down: err instanceof SourceDownError };
      }
    },
    async pull() {
      const a = umamiAccess();
      if (!a) return { kind: "failed", reason: MISSING };
      return pullUmami(a, clockNow());
    },
  },
};
