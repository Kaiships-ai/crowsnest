import { and, eq } from "drizzle-orm";
import { CONNECTORS, listConnectors } from "@/server/connectors/registry";
import type { Connector } from "@/server/connectors/types";
import { db, tables } from "@/server/db";
import type { DAILY_PULL_OUTCOMES } from "@/server/db/schema";
import { clockNow } from "@/server/lib/clock";
import { log } from "@/server/lib/logger";

export const DAILY_PULL_HOUR = 5;

export interface PullOutcome {
  connectorId: string;
  outcome: (typeof DAILY_PULL_OUTCOMES)[number];
  detail: string | null;
}

export function pullSlotDate(now: Date): string {
  const d = new Date(now);
  if (d.getHours() < DAILY_PULL_HOUR) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function textOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

async function pullConnector(connector: Connector, registry: Connector[]): Promise<PullOutcome> {
  const connectorId = connector.manifest.id;
  const status = listConnectors(registry).find((c) => c.id === connectorId)?.status;
  if (status !== "configured") return { connectorId, outcome: "skipped", detail: status ?? "not-connected" };
  const pull = connector.adapter?.pull;
  if (!pull) return { connectorId, outcome: "skipped", detail: "has no pull" };
  try {
    const result = await pull();
    if (result.kind === "complete") return { connectorId, outcome: "complete", detail: null };
    if (result.kind === "partial") return { connectorId, outcome: "partial", detail: `missing ${result.missing}: ${textOf(result.reason)}` };
    return { connectorId, outcome: "failed", detail: textOf(result.reason) };
  } catch (err) {
    return { connectorId, outcome: "failed", detail: textOf(err) };
  }
}

export async function runDailyPull(now: Date = clockNow(), registry: Connector[] = CONNECTORS): Promise<PullOutcome[]> {
  const slot = pullSlotDate(now);
  const outcomes: PullOutcome[] = [];
  for (const connector of registry) {
    const connectorId = connector.manifest.id;
    const claimed = db.insert(tables.dailyPulls).values({ slot, connectorId, startedAt: clockNow().toISOString() }).onConflictDoNothing().returning().get();
    if (!claimed) continue;
    const outcome = await pullConnector(connector, registry);
    db.update(tables.dailyPulls)
      .set({ finishedAt: clockNow().toISOString(), outcome: outcome.outcome, detail: outcome.detail })
      .where(and(eq(tables.dailyPulls.slot, slot), eq(tables.dailyPulls.connectorId, connectorId)))
      .run();
    log.info("daily_pull.connector", { slot, ...outcome });
    outcomes.push(outcome);
  }
  return outcomes;
}

export async function pullAgain(connectorId: string, registry: Connector[] = CONNECTORS): Promise<PullOutcome> {
  const connector = registry.find((c) => c.manifest.id === connectorId);
  if (!connector) throw new Error(`no connector ${connectorId}`);
  const outcome = await pullConnector(connector, registry);
  log.info("daily_pull.pull_again", { ...outcome });
  return outcome;
}

const TICK_MS = 60_000;
const BOOT_TICK_DELAY_MS = 15_000;

export function startDailyPullScheduler({ intervalMs = TICK_MS, registry = CONNECTORS }: { intervalMs?: number; registry?: Connector[] } = {}): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    runDailyPull(clockNow(), registry)
      .catch((err) => log.error("daily_pull.tick_failed", { error: textOf(err) }))
      .finally(() => {
        running = false;
      });
  };
  const boot = setTimeout(tick, BOOT_TICK_DELAY_MS);
  const timer = setInterval(tick, intervalMs);
  return () => {
    clearTimeout(boot);
    clearInterval(timer);
  };
}
