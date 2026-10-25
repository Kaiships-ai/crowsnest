import type { Connector } from "../types";

export const connector: Connector = {
  manifest: {
    id: "umami",
    label: "Umami",
    auth: "api-key",
    secrets: [{ name: "UMAMI_API_KEY", label: "API key" }],
    feeds: ["gift_page_visit", "email"],
  },
  adapter: null,
};
