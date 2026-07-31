/**
 * Structured logging — one JSON object per line on stdout/stderr.
 *
 * Deliberately dependency-free: the sync path needs machine-greppable evidence of
 * session invalidation, rate-limit backoff and per-asset failures (those log lines are
 * the only proof that recovery actually happened), and that does not justify pulling in
 * pino/winston for a local-first single-user app.
 *
 * Convention: `event` is a stable dotted name you can grep for (`sync.started`,
 * `ig.session.recovered`, `ig.ratelimit.backoff`, `asset.download.failed`). Everything
 * else goes in `fields`. Never log credentials, session blobs, or CDN URLs.
 */

import { insertLogEvent } from "@/server/logs/store";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function activeLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL;
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return "info";
}

/** Keys whose values must never reach a log line, whatever a caller passes. */
const REDACT_KEYS = new Set(["password", "ig_password", "igPassword", "token", "igServiceToken", "authorization", "cookie", "settings"]);

function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    out[REDACT_KEYS.has(k) ? `${k}_redacted` : k] = REDACT_KEYS.has(k) ? true : v;
  }
  return out;
}

function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[activeLevel()]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...redact(fields) });
  if (level === "error" || level === "warn") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);

  if (level !== "debug") {
    try {
      insertLogEvent({ ts: new Date().toISOString(), level, source: "backend", event, fields });
    } catch {
      // A logging sink must never break the caller. The line is already on stdout.
    }
  }
}

export const log = {
  debug: (event: string, fields?: LogFields) => emit("debug", event, fields),
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
};
