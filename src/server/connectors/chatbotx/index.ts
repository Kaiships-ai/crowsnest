import type { Connector } from "../types";

export const connector: Connector = {
  manifest: {
    id: "chatbotx",
    label: "ChatbotX",
    auth: "mcp",
    secrets: [{ name: "CHATBOTX_API_KEY", label: "API key" }],
    feeds: ["comment_keyword", "dm"],
  },
  adapter: null,
};
