import type { ConnectorManifest } from "../types";

export const igSidecar = {
  id: "ig-sidecar",
  label: "Instagram (instagrapi sidecar)",
  auth: "browser-session",
  secrets: [
    { name: "IG_SERVICE_TOKEN", label: "Sidecar shared token", optional: true },
    { name: "IG_USERNAME", label: "Instagram username", optional: true },
    { name: "IG_PASSWORD", label: "Instagram password", perAccount: true, optional: true },
    { name: "IG_SESSIONID", label: "Browser session id", optional: true },
  ],
  feeds: [],
} as const satisfies ConnectorManifest;
