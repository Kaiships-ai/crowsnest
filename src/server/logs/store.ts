import { and, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { logEvents } from "@/server/db/schema";

export type StoredLogLevel = "info" | "warn" | "error";
export type LogSource = "backend" | "frontend" | "sidecar";

export interface LogEventInput {
  ts: string;
  level: StoredLogLevel;
  source: LogSource;
  event: string;
  fields: Record<string, unknown>;
  runId?: string;
}
export interface LogEventRow extends LogEventInput {
  id: number;
}
export interface LogQueryFilter {
  levels?: StoredLogLevel[];
  source?: LogSource;
  event?: string;
  since?: string;
  until?: string;
  search?: string;
  limit?: number;
  runId?: string;
}

export const RETENTION_MAX = 50000;
const DEFAULT_LIMIT = 200;

/** How many inserts happen between prune passes. The prune used to run the
 *  DELETE-with-MAX(id)-subquery on every single insert; batching it here turns N deletes
 *  into N / PRUNE_INTERVAL, at the cost of letting the table grow up to
 *  RETENTION_MAX + PRUNE_INTERVAL rows between passes instead of holding exactly
 *  RETENTION_MAX at all times. That is the retention invariant this module now
 *  guarantees: never more than RETENTION_MAX + PRUNE_INTERVAL rows, oldest pruned first. */
export const PRUNE_INTERVAL = 500;

/** Inserts since the last prune pass. Module-level, not per-call — this is what lets
 *  the prune skip almost every insert instead of running unconditionally. */
let insertsSincePrune = 0;

/** Test-only escape hatch: a fresh test typically starts from an empty `log_events`
 *  table (see store.test.ts's `beforeEach`), but this counter is a module singleton
 *  that does not reset itself when the table is cleared, so a retention test run
 *  after other tests in the same file would inherit drift from their insert calls.
 *  Resetting explicitly keeps a batch-boundary test deterministic regardless of
 *  insert-call counts in tests that ran before it. */
export function resetPruneCounterForTests(): void {
  insertsSincePrune = 0;
}

/**
 * A key in this set (case-insensitively) is never stored as a value, at any
 * nesting depth. Union of this store's own keys and the Python sidecar's
 * `_SECRET_KEYS` (services/ig/crowsnest_ig/logging.py) — one list, kept in
 * sync by hand since the two run in different languages. All lowercase:
 * matching lowercases the incoming key first, so `Authorization`, `COOKIE`,
 * etc. are caught too.
 */
const REDACT_KEYS = new Set([
  "password", "ig_password", "igpassword", "token", "igservicetoken",
  "authorization", "cookie", "cookies", "settings", "sessionid", "service_token",
  "verification_code", "challenge_code", "two_factor_code", "security_code",
  "authorization_data",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recurses into nested plain objects and arrays so a secret buried inside
 *  something like `{ req: { headers: { cookie: "..." } } }` is masked the
 *  same as a top-level one. No cycle guard: log fields are JSON-shaped
 *  (already round-tripped through JSON, or about to be), never a live
 *  object graph with cycles. */
function redactValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redactValue);
  if (isPlainObject(v)) return redactObject(v);
  return v;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_KEYS.has(k.toLowerCase())) out[`${k}_redacted`] = true;
    else out[k] = redactValue(v);
  }
  return out;
}

export function redactLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  return redactObject(fields);
}

export function insertLogEvent(input: LogEventInput): void {
  const clean = redactLogFields(input.fields ?? {});
  // Bridge: an explicit runId wins, otherwise fall back to a jobId already inside fields,
  // so the many existing sync emitters get a run_id for free without being rewritten.
  const runId = input.runId ?? (typeof input.fields?.jobId === "string" ? input.fields.jobId : null);
  db.insert(logEvents)
    .values({ ts: input.ts, level: input.level, source: input.source, event: input.event, fields: JSON.stringify(clean), runId })
    .run();

  // Batched, not unconditional: this DELETE (with its MAX(id) subquery) used to run on
  // every single insert. Running it every PRUNE_INTERVAL inserts instead still holds
  // the retention invariant — monotonic autoincrement id means MAX(id) - RETENTION_MAX
  // is a gap-free cutoff, so each pass leaves exactly the newest RETENTION_MAX rows —
  // while cutting the number of DELETEs by a factor of PRUNE_INTERVAL.
  insertsSincePrune += 1;
  if (insertsSincePrune >= PRUNE_INTERVAL) {
    insertsSincePrune = 0;
    db.run(sql`delete from log_events where id <= (select max(id) - ${RETENTION_MAX} from log_events)`);
  }
}

export function queryLogEvents(filter: LogQueryFilter = {}): LogEventRow[] {
  const levels = filter.levels ?? ["warn", "error"];
  const conds = [inArray(logEvents.level, levels)];
  if (filter.source) conds.push(eq(logEvents.source, filter.source));
  if (filter.event) conds.push(like(logEvents.event, `${filter.event}%`));
  if (filter.since) conds.push(gte(logEvents.ts, filter.since));
  if (filter.until) conds.push(lte(logEvents.ts, filter.until));
  if (filter.runId) conds.push(eq(logEvents.runId, filter.runId));
  if (filter.search) {
    const needle = `%${filter.search}%`;
    conds.push(or(like(logEvents.event, needle), like(logEvents.fields, needle))!);
  }
  const rows = db
    .select()
    .from(logEvents)
    .where(and(...conds))
    .orderBy(desc(logEvents.id))
    .limit(filter.limit ?? DEFAULT_LIMIT)
    .all();
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    level: r.level as StoredLogLevel,
    source: r.source as LogSource,
    event: r.event,
    fields: safeParse(r.fields),
    runId: r.runId ?? undefined,
  }));
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
