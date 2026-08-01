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
