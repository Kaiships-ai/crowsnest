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
}

export const RETENTION_MAX = 50000;
const DEFAULT_LIMIT = 200;

/** Same rule as the stdout logger: a key in this set is never stored as a value. */
const REDACT_KEYS = new Set([
  "password", "ig_password", "igPassword", "token", "igServiceToken",
  "authorization", "cookie", "settings", "sessionid", "service_token",
]);

export function redactLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (REDACT_KEYS.has(k)) out[`${k}_redacted`] = true;
    else out[k] = v;
  }
  return out;
}

export function insertLogEvent(input: LogEventInput): void {
  const clean = redactLogFields(input.fields ?? {});
  db.insert(logEvents)
    .values({ ts: input.ts, level: input.level, source: input.source, event: input.event, fields: JSON.stringify(clean) })
    .run();
  // Monotonic autoincrement id means MAX(id) - RETENTION_MAX is the cutoff; the
  // kept window has no gaps, so this leaves exactly the newest RETENTION_MAX rows.
  db.run(sql`delete from log_events where id <= (select max(id) - ${RETENTION_MAX} from log_events)`);
}

export function queryLogEvents(filter: LogQueryFilter = {}): LogEventRow[] {
  const levels = filter.levels ?? ["warn", "error"];
  const conds = [inArray(logEvents.level, levels)];
  if (filter.source) conds.push(eq(logEvents.source, filter.source));
  if (filter.event) conds.push(like(logEvents.event, `${filter.event}%`));
  if (filter.since) conds.push(gte(logEvents.ts, filter.since));
  if (filter.until) conds.push(lte(logEvents.ts, filter.until));
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
