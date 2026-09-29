import { log } from "@/server/lib/logger";
import { isGraphConfigured } from "@/server/graph/client";
import { getOwnChannel } from "@/server/queries/channels";
import { measureOwnChannel, messageOf, type MeasureResult } from "./own-measure";

/**
 * The in-process own-channel measurement scheduler, same shape as sync-scheduler.ts: one
 * setInterval, a `let running` guard, a tick that never throws, started once from
 * server.ts. It keeps no state: which posts are due is derived from stored captures.
 */

export interface OwnMeasureSchedulerDeps {
  hasOwnChannel: () => Promise<boolean>;
  configured: () => boolean;
  measure: (now: Date) => Promise<MeasureResult>;
}

const DEFAULT_DEPS: OwnMeasureSchedulerDeps = {
  hasOwnChannel: async () => (await getOwnChannel()) !== null,
  configured: isGraphConfigured,
  measure: (now) => measureOwnChannel({ scope: "due", now }),
};

export interface OwnMeasureTickResult {
  ran: boolean;
  reason: "no_own_channel" | "not_configured" | "busy" | "failed" | "done";
  callsUsed: number;
}

/** One tick. Never throws. Logs codes and counts only, never a message that could carry a token. */
export async function runDueOwnMeasure(now: Date = new Date(), deps: Partial<OwnMeasureSchedulerDeps> = {}): Promise<OwnMeasureTickResult> {
  const d: OwnMeasureSchedulerDeps = { ...DEFAULT_DEPS, ...deps };
  try {
    if (!(await d.hasOwnChannel())) return { ran: false, reason: "no_own_channel", callsUsed: 0 };
    if (!d.configured()) return { ran: false, reason: "not_configured", callsUsed: 0 };
    const result = await d.measure(now);
    if (!result.ok) {
      if (result.code === "MEASURE_BUSY") return { ran: false, reason: "busy", callsUsed: 0 };
      log.warn("own_measure_scheduler.failed", { code: result.code });
      return { ran: true, reason: "failed", callsUsed: 0 };
    }
    log.info("own_measure_scheduler.done", { postsMeasured: result.postsMeasured, postsFailed: result.postsFailed, callsUsed: result.callsUsed, stoppedEarly: result.stoppedEarly });
    return { ran: true, reason: "done", callsUsed: result.callsUsed };
  } catch (err) {
    log.error("own_measure_scheduler.tick_failed", { error: messageOf(err) });
    return { ran: false, reason: "failed", callsUsed: 0 };
  }
}

const DEFAULT_TICK_INTERVAL_MS = 3_600_000;
function resolveTickIntervalMs(): number {
  const parsed = Number(process.env.OWN_MEASURE_SCHEDULER_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TICK_INTERVAL_MS;
}

export function startOwnMeasureScheduler(deps: Partial<OwnMeasureSchedulerDeps> & { intervalMs?: number } = {}): () => void {
  const { intervalMs, ...schedulerDeps } = deps;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runDueOwnMeasure(new Date(), schedulerDeps).finally(() => {
      running = false;
    });
  }, intervalMs ?? resolveTickIntervalMs());
  return () => clearInterval(timer);
}
