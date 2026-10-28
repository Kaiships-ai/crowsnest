import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { dispatchEngineCall } from "@/server/bridge/engine-calls";
import { db, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import { getSecret } from "@/server/secrets/store";
import { checkConnector } from "@/server/services/connector-status";
import { savePolarTokenAction, testPolarTokenAction } from "./actions";
import { connector, polarApiBase, readPolarOrganization } from "./index";

const GOOD = "polar_oat_good";
let server: Server;
let base: string;
const seen: { path: string; auth: string | undefined }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ path: req.url ?? "", auth: req.headers.authorization });
    const ok = req.headers.authorization === `Bearer ${GOOD}`;
    res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
    res.end(JSON.stringify(ok ? { items: [{ id: "org-1", name: "Kaiships", slug: "kaiships" }], pagination: { total_count: 1, max_page: 1 } } : { error: "invalid_token" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(async () => {
  migrate();
  for (const t of [tables.sealedSecrets, tables.secrets, tables.appSettings, tables.connectorStatus]) await db.delete(t);
  process.env.POLAR_API_URL = base;
  seen.length = 0;
});

const status = () => db.select().from(tables.connectorStatus).all();

describe("Polar token", () => {
  test("a 200 with one organization passes with its name, and Save stores the token and that name", async () => {
    expect(await testPolarTokenAction(GOOD)).toEqual({ ok: true, organization: "Kaiships" });
    expect(seen).toEqual([{ path: "/v1/organizations", auth: `Bearer ${GOOD}` }]);
    expect(status()).toEqual([]);

    expect(await savePolarTokenAction(GOOD)).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(getSecret("POLAR_ACCESS_TOKEN")).toBe(GOOD);
    expect(readPolarOrganization()).toBe("Kaiships");
    expect(status().map((r) => r.checkMessage)).toEqual([null]);
  });

  test("a 401 says Polar rejected the token, and Save refuses it", async () => {
    expect(await testPolarTokenAction("polar_oat_bad")).toEqual({ ok: false, message: "Polar rejected the token (401). Create a new organization token and paste it." });
    expect(await savePolarTokenAction("polar_oat_bad")).toEqual({ ok: false, error: "Test the token before you save it." });
    expect(getSecret("POLAR_ACCESS_TOKEN")).toBeUndefined();
  });

  test("Save refuses a token other than the one that just passed, and stores nothing", async () => {
    expect(await testPolarTokenAction(GOOD)).toEqual({ ok: true, organization: "Kaiships" });
    expect(await savePolarTokenAction("polar_oat_other")).toEqual({ ok: false, error: "Test the token before you save it." });
    expect(getSecret("POLAR_ACCESS_TOKEN")).toBeUndefined();
    expect(readPolarOrganization()).toBeNull();
    expect(status()).toEqual([]);
  });

  test("a blank or whitespace-only token is refused at the bridge with Enter a token.", async () => {
    for (const call of ["testPolarTokenAction", "savePolarTokenAction"]) {
      const res = await dispatchEngineCall(call, ["   "]);
      expect(res).toMatchObject({ ok: false, error: { code: "bad_args" } });
      expect(!res.ok && res.error.message).toContain("Enter a token.");
    }
    expect(seen).toEqual([]);
  });

  test("a token written through the generic secret call never shows the organization another token proved", async () => {
    await testPolarTokenAction(GOOD);
    await savePolarTokenAction(GOOD);
    expect(readPolarOrganization()).toBe("Kaiships");
    expect(await dispatchEngineCall("setConnectorSecret", ["polar", "POLAR_ACCESS_TOKEN", "polar_oat_other"])).toEqual({ ok: true, value: { ok: true } });
    expect(await dispatchEngineCall("getPolarOrganization", [])).toEqual({ ok: true, value: null });
  });

  test("POLAR_API_URL is honored only when the app is not packaged", () => {
    expect(polarApiBase(false)).toBe(base);
    expect(polarApiBase(true)).toBe("https://api.polar.sh");
    delete process.env.POLAR_API_URL;
    expect(polarApiBase(false)).toBe("https://api.polar.sh");
  });

  test("a network error says Polar cannot be reached", async () => {
    process.env.POLAR_API_URL = "http://127.0.0.1:9";
    expect(await testPolarTokenAction(GOOD)).toEqual({ ok: false, message: "Cannot reach Polar. Check your internet connection, then test again." });
  });

  test("Test connection on the card records the saved token's 401 as the card's error", async () => {
    await testPolarTokenAction(GOOD);
    await savePolarTokenAction(GOOD);
    db.delete(tables.sealedSecrets).run();
    db.delete(tables.secrets).run();
    process.env.POLAR_ACCESS_TOKEN = "polar_oat_revoked";
    try {
      expect(await checkConnector("polar", [connector])).toEqual({ ok: false, message: "Polar rejected the token (401). Create a new organization token and paste it." });
      expect(status().map((r) => r.checkMessage)).toEqual(["Polar rejected the token (401). Create a new organization token and paste it."]);
      expect(db.select().from(tables.appSettings).all()).toEqual([]);
    } finally {
      delete process.env.POLAR_ACCESS_TOKEN;
    }
  });

  test.each([
    ["unreachable", "http://127.0.0.1:9", false],
    ["no token", null, true],
  ])("a saved-token check that fails (%s) clears the kept organization", async (_label, url, dropToken) => {
    await testPolarTokenAction(GOOD);
    await savePolarTokenAction(GOOD);
    if (url) process.env.POLAR_API_URL = url;
    if (dropToken) {
      db.delete(tables.sealedSecrets).run();
      db.delete(tables.secrets).run();
    }
    expect((await checkConnector("polar", [connector])).ok).toBe(false);
    expect(db.select().from(tables.appSettings).all()).toEqual([]);
  });
});
