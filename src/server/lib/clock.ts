import { config } from "@/server/config";

const start = config.LEAD_STUDIO_CLOCK_START ? Date.parse(config.LEAD_STUDIO_CLOCK_START) : null;
const bootedAt = Date.now();

export function clockNow(): Date {
  return start === null ? new Date() : new Date(start + Date.now() - bootedAt);
}
