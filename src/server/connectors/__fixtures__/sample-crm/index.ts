import { readSecret } from "../../secrets";
import type { Connector, ConnectorManifest } from "../../types";

const manifest = {
  id: "sample-crm",
  label: "Sample CRM",
  auth: "api-key",
  secrets: [{ name: "SAMPLE_CRM_KEY", label: "API key" }],
  feeds: ["purchase"],
} as const satisfies ConnectorManifest;

export const connector: Connector = {
  manifest,
  adapter: {
    async testConnection() {
      return readSecret(manifest, "SAMPLE_CRM_KEY") ? { ok: true, message: null } : { ok: false, message: "no API key" };
    },
    async pull() {
      return { kind: "complete", rows: [{ orders: 3 }] };
    },
  },
};
