import { CONNECTORS, listConnectors, testConnector } from "@/server/connectors/registry";
import type { ConnectionCheck, Connector } from "@/server/connectors/types";
import { db, tables } from "@/server/db";
import { SyncAlreadyRunningError } from "@/server/ig/errors";
import { clockNow } from "@/server/lib/clock";
import { log } from "@/server/lib/logger";
import type { PullResult } from "@/server/lib/pull-result";

export type StatusRow = typeof tables.connectorStatus.$inferSelect;
/** The one state a card shows, derived from the row. */
export interface CardStatus {
  state: NonNullable<StatusRow["pullState"]>;
  message: string | null;
  detail: string | null;
}

const PULL_FAILED = "The last pull failed, so the older numbers stay. Re-check the key.";
const PULL_PARTIAL = "The last pull did not finish, so some numbers are older.";

const textOf = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason));

function upsert(connectorId: string, set: Partial<Omit<StatusRow, "connectorId" | "updatedAt">>): void {
  const now = clockNow().toISOString();
  db.insert(tables.connectorStatus)
    .values({ connectorId, ...set, updatedAt: now })
    .onConflictDoUpdate({ target: tables.connectorStatus.connectorId, set: { ...set, updatedAt: now } })
    .run();
}

/** Check error > pull error > pull partial > ready. A passing check proves the key, not the data, so it never hides a pull's outcome. */
export function cardStatus(row: StatusRow | undefined): CardStatus {
  if (row?.checkMessage) return { state: "error", message: row.checkMessage, detail: null };
  if (row?.pullState && row.pullState !== "ready") return { state: row.pullState, message: row.pullMessage, detail: row.pullDetail };
  return { state: "ready", message: null, detail: null };
}

/** A check writes only its own outcome: a failure's message, or null when it passed. */
export function recordCheck(connectorId: string, check: ConnectionCheck): void {
  const checkMessage = check.ok ? null : (check.message ?? "The check failed. Re-check the key.");
  upsert(connectorId, { checkMessage, checkedAt: clockNow().toISOString() });
}

/** A pull's outcome stays until the next pull. */
export function recordPull(connectorId: string, result: PullResult<unknown, unknown>): CardStatus {
  const outcome: CardStatus =
    result.kind === "complete" ? { state: "ready", message: null, detail: null }
    : result.kind === "partial" ? { state: "partial", message: PULL_PARTIAL, detail: `missing ${result.missing}: ${textOf(result.reason)}` }
    : { state: "error", message: PULL_FAILED, detail: textOf(result.reason) };
  upsert(connectorId, { pullState: outcome.state, pullMessage: outcome.message, pullDetail: outcome.detail, pulledAt: clockNow().toISOString() });
  return outcome;
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

/** Pulls one connector now, when asked through the bridge, and records the outcome. Nothing pulls on a schedule.
 *  A pull that loses to a running sync throws and records nothing: that sync records its own outcome. */
export async function pullConnector(connectorId: string, registry: Connector[] = CONNECTORS): Promise<CardStatus> {
  const connector = registry.find((c) => c.manifest.id === connectorId);
  if (!connector) throw new Error(`no connector ${connectorId}`);
  const pull = connector.adapter?.pull;
  if (!pull) throw new Error(`${connectorId} has no pull`);
  if (listConnectors([connector])[0].status !== "configured") throw new Error(`${connectorId} is not set up`);
  let result: PullResult<unknown, unknown>;
  try {
    result = await pull();
  } catch (err) {
    if (err instanceof SyncAlreadyRunningError) throw err;
    result = { kind: "failed", reason: err };
  }
  log.info("connector.pull", { connectorId, kind: result.kind });
  return recordPull(connectorId, result);
}
