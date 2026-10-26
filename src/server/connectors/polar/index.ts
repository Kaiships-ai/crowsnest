import type { Connector } from "../types";

export const connector: Connector = {
  manifest: {
    id: "polar",
    label: "Polar",
    auth: "api-key",
    secrets: [{ name: "POLAR_ACCESS_TOKEN", label: "Access token" }],
    feeds: ["purchase", "revenue"],
  },
  adapter: null,
};
