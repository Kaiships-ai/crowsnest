import { eq } from "drizzle-orm";
import { CONNECTORS, listConnectors, testConnector } from "@/server/connectors/registry";
import type { ConnectionCheck, Connector } from "@/server/connectors/types";
import { db, tables } from "@/server/db";
import { clockNow } from "@/server/lib/clock";
import { log } from "@/server/lib/logger";
import type { PullResult } from "@/server/lib/pull-result";

export type StatusRow = typeof tables.connectorStatus.$inferSelect;
type Event = Pick<StatusRow, "state" | "message" | "detail"> & { kind: "check" | "pull" };

const PULL_FAILED = "The last pull failed, so the older numbers stay. Check the key, then pull again.";
const PULL_PARTIAL = "The last pull did not finish, so the older numbers stay. Pull again later.";

const textOf = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason));

/** Upserts the connector's row: the newest event, check or pull, is the card's state. */
function record(connectorId: string, { kind, ...event }: Event): StatusRow {
  const now = clockNow().toISOString();
  const stamp = kind === "check" ? { checkedAt: now } : { pulledAt: now };
  return db
    .insert(tables.connectorStatus)
    .values({ connectorId, ...event, ...stamp, updatedAt: now })
    .onConflictDoUpdate({ target: tables.connectorStatus.connectorId, set: { ...event, ...stamp, updatedAt: now } })
    .returning()
    .get();
}

/** A failed check is an error. A passing check proves the key, not the data: it keeps a partial pull's state and clears an error. */
export function afterCheck(prior: Pick<StatusRow, "state" | "message" | "detail"> | undefined, check: ConnectionCheck): Omit<Event, "kind"> {
  if (!check.ok) return { state: "error", message: check.message ?? "The check failed. Check the key, then check again.", detail: null };
  if (prior?.state === "partial") return { state: prior.state, message: prior.message, detail: prior.detail };
  return { state: "ready", message: null, detail: null };
}

export function recordCheck(connectorId: string, check: ConnectionCheck): StatusRow {
  const prior = db.select().from(tables.connectorStatus).where(eq(tables.connectorStatus.connectorId, connectorId)).get();
  return record(connectorId, { kind: "check", ...afterCheck(prior, check) });
}

export function recordPull(connectorId: string, result: PullResult<unknown, unknown>): StatusRow {
  if (result.kind === "complete") return record(connectorId, { kind: "pull", state: "ready", message: null, detail: null });
  if (result.kind === "partial") return record(connectorId, { kind: "pull", state: "partial", message: PULL_PARTIAL, detail: `missing ${result.missing}: ${textOf(result.reason)}` });
  return record(connectorId, { kind: "pull", state: "error", message: PULL_FAILED, detail: textOf(result.reason) });
}

export function readStatuses(): Map<string, StatusRow> {
  return new Map(db.select().from(tables.connectorStatus).all().map((r) => [r.connectorId, r]));
}

/** Runs the connector's connection check and records it. */
export async function checkConnector(connectorId: string, registry: Connector[] = CONNECTORS): Promise<ConnectionCheck> {
  const check = await testConnector(connectorId, registry);
  recordCheck(connectorId, check);
  log.info("connector.check", { connectorId, ok: check.ok });
  return check;
}

/** Pulls one connector now, on the operator's click, and records the outcome. Nothing pulls on a schedule. */
export async function pullConnector(connectorId: string, registry: Connector[] = CONNECTORS): Promise<StatusRow> {
  const connector = registry.find((c) => c.manifest.id === connectorId);
  if (!connector) throw new Error(`no connector ${connectorId}`);
  const pull = connector.adapter?.pull;
  if (!pull) throw new Error(`${connectorId} has no pull`);
  if (listConnectors([connector])[0].status !== "configured") throw new Error(`${connectorId} is not set up`);
  let result: PullResult<unknown, unknown>;
  try {
    result = await pull();
  } catch (err) {
    result = { kind: "failed", reason: err };
  }
  log.info("connector.pull", { connectorId, kind: result.kind });
  return recordPull(connectorId, result);
}
