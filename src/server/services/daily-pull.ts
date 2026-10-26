import { and, eq, sql } from "drizzle-orm";
import { CONNECTORS, listConnectors, type ConnectorStatus } from "@/server/connectors/registry";
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

type Statuses = Map<string, ConnectorStatus>;
const statusesOf = (registry: Connector[]): Statuses => new Map(listConnectors(registry).map((c) => [c.id, c.status]));

function notReady(connector: Connector, statuses: Statuses): string | null {
  const status = statuses.get(connector.manifest.id) ?? "not-connected";
  if (status !== "configured") return status;
  return connector.adapter?.pull ? null : "has no pull";
}

async function pullConnector(connector: Connector, statuses: Statuses): Promise<PullOutcome> {
  const connectorId = connector.manifest.id;
  const skip = notReady(connector, statuses);
  const pull = connector.adapter?.pull;
  if (skip || !pull) return { connectorId, outcome: "skipped", detail: skip };
  try {
    const result = await pull();
    if (result.kind === "complete") return { connectorId, outcome: "complete", detail: null };
    if (result.kind === "partial") return { connectorId, outcome: "partial", detail: `missing ${result.missing}: ${textOf(result.reason)}` };
    return { connectorId, outcome: "failed", detail: textOf(result.reason) };
  } catch (err) {
    return { connectorId, outcome: "failed", detail: textOf(err) };
  }
}

export const MAX_PULL_ATTEMPTS = 3;
export const RETRY_AFTER_MS = 5 * 60_000;
const processStartedAt = clockNow().toISOString();

/** Claims the connector's row for the slot. An existing row is taken over when an earlier
 *  process left it unfinished, when it was skipped and the connector is ready now, or when
 *  it failed with attempts left and RETRY_AFTER_MS has passed. */
function claim(slot: string, connectorId: string, ready: boolean): boolean {
  const { dailyPulls: t } = tables;
  const now = clockNow();
  const retryIfFinishedBy = new Date(now.getTime() - RETRY_AFTER_MS).toISOString();
  const row = db
    .insert(t)
    .values({ slot, connectorId, startedAt: now.toISOString() })
    .onConflictDoUpdate({
      target: [t.slot, t.connectorId],
      set: { startedAt: now.toISOString(), finishedAt: null, outcome: null, detail: null, attempts: sql`case when ${t.outcome} = 'skipped' then 1 else ${t.attempts} + 1 end` },
      setWhere: sql`(${t.outcome} is null and ${t.startedAt} < ${processStartedAt})
        or (${t.outcome} = 'skipped' and ${ready ? 1 : 0} = 1)
        or (${t.outcome} = 'failed' and ${t.attempts} < ${MAX_PULL_ATTEMPTS} and ${t.finishedAt} <= ${retryIfFinishedBy})`,
    })
    .returning()
    .get();
  return row !== undefined;
}

export async function runDailyPull(now: Date = clockNow(), registry: Connector[] = CONNECTORS): Promise<PullOutcome[]> {
  const slot = pullSlotDate(now);
  const statuses = statusesOf(registry);
  const outcomes: PullOutcome[] = [];
  for (const connector of registry) {
    const connectorId = connector.manifest.id;
    if (!claim(slot, connectorId, notReady(connector, statuses) === null)) continue;
    const outcome = await pullConnector(connector, statuses);
    db.update(tables.dailyPulls)
      .set({ finishedAt: clockNow().toISOString(), outcome: outcome.outcome, detail: outcome.detail })
      .where(and(eq(tables.dailyPulls.slot, slot), eq(tables.dailyPulls.connectorId, connectorId)))
      .run();
    log.info("daily_pull.connector", { slot, ...outcome });
    outcomes.push(outcome);
  }
  return outcomes;
}

export interface LastPull {
  slot: string;
  at: string;
  outcome: PullOutcome["outcome"];
  detail: string | null;
}

const manualPulls = new Map<string, LastPull>();

export function lastPulls(): Map<string, LastPull> {
  const { dailyPulls: t } = tables;
  const rows = db.select().from(t).where(sql`${t.finishedAt} is not null`).orderBy(t.finishedAt).all();
  const last = new Map<string, LastPull>();
  for (const r of rows) if (r.finishedAt && r.outcome) last.set(r.connectorId, { slot: r.slot, at: r.finishedAt, outcome: r.outcome, detail: r.detail });
  for (const [id, manual] of manualPulls) {
    const slot = last.get(id);
    if (!slot || slot.at <= manual.at) last.set(id, manual);
  }
  return last;
}

export async function pullAgain(connectorId: string, registry: Connector[] = CONNECTORS): Promise<PullOutcome> {
  const connector = registry.find((c) => c.manifest.id === connectorId);
  if (!connector) throw new Error(`no connector ${connectorId}`);
  const outcome = await pullConnector(connector, statusesOf(registry));
  const now = clockNow();
  manualPulls.set(connectorId, { slot: pullSlotDate(now), at: now.toISOString(), outcome: outcome.outcome, detail: outcome.detail });
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
