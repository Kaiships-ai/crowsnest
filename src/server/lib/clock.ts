import { config } from "@/server/config";

const start = config.LEAD_STUDIO_CLOCK_START ? Date.parse(config.LEAD_STUDIO_CLOCK_START) : null;
const bootedAt = Date.now();

export function clockNow(): Date {
  if (start === null) return new Date();
  return new Date(config.LEAD_STUDIO_CLOCK_FROZEN ? start : start + Date.now() - bootedAt);
}
