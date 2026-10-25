import type { ConnectorManifest } from "../types";

export const instagramGraph = {
  id: "instagram-graph",
  label: "Instagram Graph API",
  auth: "oauth",
  secrets: [
    { name: "IG_GRAPH_TOKEN", label: "Access token" },
    { name: "IG_GRAPH_USER_ID", label: "Instagram user id" },
  ],
  feeds: ["view", "follow", "bio_link_tap"],
} as const satisfies ConnectorManifest;
