import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "@/server/config";
import { insertLogEvent } from "@/server/logs/store";

/**
 * `POST /api/logs/ingest` — the single write path for the system logs feature (design
 * spec docs/superpowers/specs/2026-07-31-system-logs-design.md). Backend, frontend and
 * the Python sidecar all funnel through this one endpoint rather than writing to the
 * `log_events` table directly, so redaction and the token gate can't be bypassed by a
 * caller that forgets to apply them.
 *
 * Node runtime: `insertLogEvent` goes through `better-sqlite3`, which has no edge build.
 *
 * `source: "sidecar"` is the only one gated by `X-IG-Token`. The Python sidecar holds
 * the same shared secret used for the Node -> Python hop (see config.ts), so this reuses
 * it rather than minting a second credential. Backend and frontend posts are same-process
 * / same-origin already and need no token.
 *
 * `insertLogEvent` redacts internally (see src/server/logs/store.ts), but the caller is
 * never trusted to have redacted first — a frontend bug or a compromised sidecar could
 * ship a raw password in `fields`, so redaction always re-runs here regardless of who sent it.
 */
export const runtime = "nodejs";

const Body = z.object({
  ts: z.string().min(1),
  level: z.enum(["info", "warn", "error"]),
  source: z.enum(["backend", "frontend", "sidecar"]),
  event: z.string().min(1),
  // zod v4 requires both a key and value schema for z.record (unlike v3's single-arg form).
  fields: z.record(z.string(), z.unknown()).default({}),
});

/** Constant-time compare against the shared secret, same idea the sidecar itself uses
 *  for the Node -> Python hop. A `!==` length/content check here would leak the token's
 *  length and contents one byte at a time through response-timing side channels. */
function tokenOk(header: string | null): boolean {
  const expected = config.IG_SERVICE_TOKEN;
  if (!header || !expected) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return new Response(null, { status: 400 });

  const evt = parsed.data;
  if (evt.source === "sidecar" && !tokenOk(request.headers.get("x-ig-token"))) {
    return new Response(null, { status: 401 });
  }

  insertLogEvent({ ts: evt.ts, level: evt.level, source: evt.source, event: evt.event, fields: evt.fields });
  return new Response(null, { status: 204 });
}
