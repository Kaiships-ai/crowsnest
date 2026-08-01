import { beforeAll, beforeEach, describe, expect, test } from "vitest";

/**
 * `config` throws at module load if `IG_SERVICE_TOKEN` is absent (see config.ts), and
 * `./route` imports `config` at its top level. Every other suite that touches config
 * (e.g. channel-actions.test.ts) sets the env var and then imports dynamically in
 * `beforeAll`, rather than a static top-of-file import, so this file works standalone
 * (`npx vitest run src/app/api/logs/ingest/route.test.ts`) regardless of run order.
 */

let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let queryLogEvents: typeof import("@/server/logs/store")["queryLogEvents"];
let POST: typeof import("./route")["POST"];
let realToken: string;

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ queryLogEvents } = await import("@/server/logs/store"));
  ({ POST } = await import("./route"));
  // The route validates against the secrets store's token (db first, env fallback). No
  // db row is set here and the secrets table is migrated per-test (beforeEach), so at
  // request time getOrCreateServiceToken() resolves to this env value. Read it from the
  // env rather than calling the store here, which would query the not-yet-migrated table.
  realToken = process.env.IG_SERVICE_TOKEN ?? "test-token";
});

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/logs/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
const base = { ts: "2026-07-31T10:00:00.000Z", level: "error", event: "e", fields: {} };

describe("POST /api/logs/ingest", () => {
  beforeEach(() => migrate());

  test("frontend post needs no token and is stored", async () => {
    const res = await POST(req({ ...base, source: "frontend" }));
    expect(res.status).toBe(204);
    expect(queryLogEvents({ levels: ["error"], source: "frontend" })).toHaveLength(1);
  });

  test("sidecar post without a valid token is 401 and not stored", async () => {
    const res = await POST(req({ ...base, source: "sidecar" }, { "x-ig-token": "wrong" }));
    expect(res.status).toBe(401);
    expect(queryLogEvents({ levels: ["error"], source: "sidecar" })).toHaveLength(0);
  });

  test("sidecar post with the real token is stored", async () => {
    const res = await POST(req({ ...base, source: "sidecar" }, { "x-ig-token": realToken }));
    expect(res.status).toBe(204);
    expect(queryLogEvents({ levels: ["error"], source: "sidecar" })).toHaveLength(1);
  });

  test("malformed body is 400", async () => {
    const res = await POST(req({ level: "error" }));
    expect(res.status).toBe(400);
  });

  test("payload with a password is redacted before storage", async () => {
    await POST(req({ ...base, source: "frontend", fields: { password: "hunter2", ok: 1 } }));
    expect(queryLogEvents({ levels: ["error"], source: "frontend" })[0].fields).toEqual({ password_redacted: true, ok: 1 });
  });
});
