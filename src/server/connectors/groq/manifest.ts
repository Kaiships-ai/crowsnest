import type { ConnectorManifest } from "../types";

export const groq = {
  id: "groq",
  label: "Groq transcription",
  auth: "api-key",
  secrets: [{ name: "GROQ_API_KEY", label: "API key" }],
  feeds: [],
} as const satisfies ConnectorManifest;
