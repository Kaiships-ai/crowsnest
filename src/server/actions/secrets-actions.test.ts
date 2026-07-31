import { beforeAll, beforeEach, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let actions: typeof import("./secrets-actions");

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  actions = await import("./secrets-actions");
});
beforeEach(async () => {
  migrate();
  await db.delete(tables.secrets);
});

describe("secrets actions", () => {
  test("set rejects an unknown name", async () => {
    const r = await actions.setSecretAction("NOT_A_SECRET", "x");
    expect(r.ok).toBe(false);
  });

  test("set then status shows configured from db", async () => {
    await actions.setSecretAction("GROQ_API_KEY", "sk-1");
    const s = (await actions.getSecretStatusAction()).find((x) => x.name === "GROQ_API_KEY");
    expect(s).toMatchObject({ configured: true, source: "db" });
  });

  test("no value leaks in a response", async () => {
    await actions.setSecretAction("GROQ_API_KEY", "super-secret");
    const json = JSON.stringify(await actions.getSecretStatusAction());
    expect(json).not.toContain("super-secret");
  });

  test("clear removes the db row", async () => {
    await actions.setSecretAction("GROQ_API_KEY", "sk-1");
    await actions.clearSecretAction("GROQ_API_KEY");
    const s = (await actions.getSecretStatusAction()).find((x) => x.name === "GROQ_API_KEY");
    expect(s?.source).not.toBe("db");
  });

  test("regenerate service token changes the stored value and returns ok", async () => {
    await actions.setSecretAction("IG_SERVICE_TOKEN", "original-token");
    const before = (await actions.getSecretStatusAction()).find((x) => x.name === "IG_SERVICE_TOKEN");
    expect(before).toMatchObject({ configured: true, source: "db" });

    const result = await actions.regenerateServiceTokenAction();
    expect(result.ok).toBe(true);

    const row = db.select().from(tables.secrets).all().find((r) => r.name === "IG_SERVICE_TOKEN");
    expect(row?.value).toBeDefined();
    expect(row?.value).not.toBe("original-token");
    expect(row?.value?.length).toBeGreaterThanOrEqual(64); // 32 bytes hex-encoded
  });
});
