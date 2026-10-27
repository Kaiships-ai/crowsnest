import { and, eq } from "drizzle-orm";
import { CONNECTORS, listConnectors, testConnector } from "@/server/connectors/registry";
import type { ConnectionCheck, Connector, Sample } from "@/server/connectors/types";
import { db, tables } from "@/server/db";
import { SyncAlreadyRunningError } from "@/server/ig/errors";
import { clockNow } from "@/server/lib/clock";
import { log } from "@/server/lib/logger";
import { SourceDownError, type PullResult } from "@/server/lib/pull-result";

export type StatusRow = typeof tables.connectorStatus.$inferSelect;
/** The one state a card shows, derived from the row. */
export interface CardStatus {
  state: NonNullable<StatusRow["pullState"]> | "off";
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

/** Off > pulling > check error > pull error > pull partial > ready. A passing check proves the key, not the data, so it never hides a pull's outcome. */
export function cardStatus(row: StatusRow | undefined): CardStatus {
  if (row?.offAt) return { state: "off", message: null, detail: null };
  if (row?.pullState === "pulling") return { state: "pulling", message: null, detail: null };
  if (row?.checkMessage) return { state: "error", message: row.checkMessage, detail: null };
  if (row?.pullState && row.pullState !== "ready") return { state: row.pullState, message: row.pullMessage, detail: row.pullDetail };
  return { state: "ready", message: null, detail: null };
}

/** A check writes only its own outcome: a failure's message, or null when it passed. */
export function recordCheck(connectorId: string, check: ConnectionCheck): void {
  const checkMessage = check.ok ? null : (check.message ?? "The check failed. Re-check the key.");
  upsert(connectorId, { checkMessage, checkedAt: clockNow().toISOString() });
}

type PullOutcome = Omit<CardStatus, "state"> & { state: "ready" | "partial" | "error" };

/** A pull's outcome stays until the next pull. A complete pull also proves the key, so it clears a check's error. */
export function recordPull(connectorId: string, result: PullResult<unknown, unknown>): CardStatus {
  const outcome: PullOutcome =
    result.kind === "complete" ? { state: "ready", message: null, detail: null }
    : result.kind === "partial" ? { state: "partial", message: PULL_PARTIAL, detail: `missing ${result.missing}: ${textOf(result.reason)}` }
    : { state: "error", message: PULL_FAILED, detail: textOf(result.reason) };
  upsert(connectorId, {
    pullState: outcome.state,
    pullMessage: outcome.message,
    pullDetail: outcome.detail,
    pulledAt: clockNow().toISOString(),
    ...(result.kind === "complete" ? { checkMessage: null } : {}),
  });
  return outcome;
}

/** How a pull ended early. `interrupted` is a pull whose process went away (quit, crash) or went silent. */
export type PullStop = "stopped" | "limited" | "source-down" | "interrupted";

export interface PullItem {
  label: string;
  result: "updated" | "limited" | "failed" | "not-pulled";
}

export interface PullSummary {
  total: number;
  done: number;
  updated: number;
  newItems: number;
  failed: number;
  durationSec: number;
  startedAt: string | null;
  /** What the pull covered, such as "last 30 days", when the source pulls a time window. */
  window?: string;
  /** When the items this pull did not reach got their numbers: the pull before it. */
  olderFrom: string | null;
  stop: PullStop | null;
  /** Each item in pull order, so the card can say which one hit the limit. */
  items: PullItem[];
  /** The Graph pull's follower count, and the change since the snapshot before it when there is one. */
  followers?: { count: number; delta: number | null };
}

/** The JSON in `connector_status.summary`. */
export interface ConnectorSummary {
  /** One line from the last passing test, such as "@kaiships.ai · 12,345 followers · 210 posts". */
  sample?: string;
  pull?: PullSummary;
  /** The newest failed test or pull failed because the source did not answer (`SourceDownError`). */
  down?: boolean;
}

/** A `pulling` row with no heartbeat for this long reads as Partial. */
export const PULL_STALE_MS = 10 * 60_000;

// ponytail: pulls run in the app's one main process, so a pulling row this process did not start
// belongs to a process that quit or crashed. A pull run from another process would read as Partial.
const livePulls = new Set<string>();

export function parseSummary(raw: string | null): ConnectorSummary {
  // SAFETY: only `withSummary` and `settleStale` in this file write the column, always from a ConnectorSummary.
  return raw ? (JSON.parse(raw) as ConnectorSummary) : {};
}

function readRow(connectorId: string): StatusRow | undefined {
  return db.select().from(tables.connectorStatus).where(eq(tables.connectorStatus.connectorId, connectorId)).get();
}

function withSummary(connectorId: string, patch: ConnectorSummary): string {
  return JSON.stringify({ ...parseSummary(readRow(connectorId)?.summary ?? null), ...patch });
}

/** A crashed or silent pull never leaves a card stuck in Pulling: it reads as Partial with its done count. */
function settleStale(row: StatusRow, now: Date): StatusRow {
  if (row.pullState !== "pulling") return row;
  if (livePulls.has(row.connectorId) && now.getTime() - Date.parse(row.updatedAt) < PULL_STALE_MS) return row;
  const done = row.progressDone ?? 0;
  const total = row.progressTotal ?? done;
  const pull: PullSummary = { total, done, updated: done, newItems: 0, failed: 0, durationSec: 0, startedAt: row.startedAt, olderFrom: row.pulledAt, stop: "interrupted", items: [] };
  return {
    ...row,
    pullState: "partial",
    pullMessage: `The pull stopped at ${done}/${total} before it finished. ${done} have new numbers; the rest keep their older numbers.`,
    pullDetail: null,
    summary: JSON.stringify({ ...parseSummary(row.summary), pull }),
  };
}

export function readStatuses(now: Date = clockNow()): Map<string, StatusRow> {
  return new Map(db.select().from(tables.connectorStatus).all().map((r) => [r.connectorId, settleStale(r, now)]));
}

export function recordPullStart(connectorId: string): void {
  livePulls.add(connectorId);
  upsert(connectorId, { pullState: "pulling", pullMessage: null, pullDetail: null, startedAt: clockNow().toISOString(), progressDone: 0, progressTotal: null, progressLabel: null, retryAfter: null });
}

/** Also the pull's heartbeat. Undefined fields keep their value. */
export function recordPullProgress(connectorId: string, progress: { done: number; total?: number; label?: string | null }): void {
  db.update(tables.connectorStatus)
    .set({
      progressDone: progress.done,
      ...(progress.total !== undefined ? { progressTotal: progress.total } : {}),
      ...(progress.label !== undefined ? { progressLabel: progress.label } : {}),
      updatedAt: clockNow().toISOString(),
    })
    .where(and(eq(tables.connectorStatus.connectorId, connectorId), eq(tables.connectorStatus.pullState, "pulling")))
    .run();
}

/** Records the pull's outcome as `recordPull` does, plus its summary and the source's retry time. */
export function recordPullEnd(connectorId: string, result: PullResult<unknown, unknown>, ended: Omit<PullSummary, "olderFrom">, retryAfter: string | null = null): CardStatus {
  livePulls.delete(connectorId);
  const pull: PullSummary = { ...ended, olderFrom: readRow(connectorId)?.pulledAt ?? null };
  const outcome = recordPull(connectorId, result);
  upsert(connectorId, { progressDone: pull.done, progressTotal: pull.total, progressLabel: null, retryAfter, summary: withSummary(connectorId, { pull, down: result.kind !== "complete" && result.reason instanceof SourceDownError }) });
  return outcome;
}

/** Records a Test connection's sample: a pass keeps its line for the card; a fail is the card's check error. */
export function recordSample(connectorId: string, sample: Sample): Sample {
  recordCheck(connectorId, sample.ok ? { ok: true, message: null } : { ok: false, message: sample.message });
  upsert(connectorId, sample.ok ? { retryAfter: null, summary: withSummary(connectorId, { sample: sample.line, down: false }) } : { retryAfter: sample.retryAfter, summary: withSummary(connectorId, { down: sample.down === true }) });
  log.info("connector.sample", { connectorId, ok: sample.ok });
  return sample;
}

/** Test connection: one real read through the adapter, recorded. */
export async function sampleConnector(connectorId: string, registry: Connector[] = CONNECTORS): Promise<Sample> {
  const sample = registry.find((c) => c.manifest.id === connectorId)?.adapter?.sample;
  if (!sample) throw new Error(`${connectorId} has no sample`);
  let result: Sample;
  try {
    result = await sample();
  } catch (err) {
    result = { ok: false, message: textOf(err), retryAfter: null, down: err instanceof SourceDownError };
  }
  return recordSample(connectorId, result);
}

/** The sidecar switch. Off is its own state, above any check or pull. */
export function recordSwitch(connectorId: string, on: boolean): void {
  upsert(connectorId, { offAt: on ? null : clockNow().toISOString() });
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
