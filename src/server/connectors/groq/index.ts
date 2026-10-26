import { groqAvailability } from "@/server/transcribe/groq";
import type { Connector } from "../types";
import { groq } from "./manifest";

export const connector: Connector = {
  manifest: groq,
  adapter: {
    async testConnection() {
      const { available, reason } = groqAvailability();
      return { ok: available, message: reason ?? null };
    },
  },
};
