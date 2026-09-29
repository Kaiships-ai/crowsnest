import { beforeEach, describe, expect, test, vi } from "vitest";

// Real Graph client, stubbed fetch: pins token redaction and the graph host through the
// measurement service (SEC-04, SEC-06).
const TOKEN = "tok_SUPER_secret_123";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  process.env.IG_SERVICE_TOKEN ??= "test-token-long-enough";
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_GRAPH_TOKEN = TOKEN;
  process.env.IG_GRAPH_USER_ID = "17841400000000000";
});

async function load() {
  const { migrate } = await import("@/server/db/test-migrate");
  migrate();
  const { log } = await import("@/server/lib/logger");
  const logged: unknown[] = [];
  for (const level of ["debug", "info", "warn", "error"] as const) vi.spyOn(log, level).mockImplementation((...args: unknown[]) => { logged.push(args); });
  const svc = await import("./own-measure");
  return { svc, logged };
}

describe("own measurement security", () => {
  test("SEC-04: an error body echoing the token never reaches a log line or the result", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "a", username: "me" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{ id: "r1", media_type: "VIDEO", media_product_type: "REELS", permalink: "p", timestamp: "2026-09-01T00:00:00+0000" }] }) })
      .mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: { message: `bad token ${TOKEN}` } }) }));
    const { svc, logged } = await load();
    const r = await svc.measureOwnChannel({ scope: "all" });
    expect(JSON.stringify(logged)).not.toContain(TOKEN);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  test("SEC-06: every outbound request goes to graph.instagram.com", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "a", username: "me" }) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    const { svc } = await load();
    await svc.measureOwnChannel({ scope: "due" });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    for (const [url] of fetchMock.mock.calls) expect(new URL(url as string).host).toBe("graph.instagram.com");
  });
});
