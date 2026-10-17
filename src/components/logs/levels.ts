import type { StoredLogLevel } from "@/server/logs/store";

export const LOG_LEVELS: StoredLogLevel[] = ["info", "warn", "error"];
/** What a bare /logs shows. */
export const DEFAULT_LOG_LEVELS: StoredLogLevel[] = ["warn", "error"];
