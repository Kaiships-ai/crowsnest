import { beforeAll, beforeEach, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let actions: typeof import("./secrets-actions");
let getSecret: typeof import("@/server/secrets/store")["getSecret"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  actions = await import("./secrets-actions");
  ({ getSecret } = await import("@/server/secrets/store"));
});
beforeEach(async () => {
  migrate();
  await db.delete(tables.secrets);
  await db.delete(tables.sealedSecrets);
});

describe("secrets actions", () => {
  test("set rejects an unknown name", async () => {
    const r = await actions.setSecretAction("NOT_A_SECRET", "x");
    expect(r.ok).toBe(false);
  });

  test("set then status shows configured from the keychain", async () => {
    await actions.setSecretAction("GROQ_API_KEY", "sk-1");
    const s = (await actions.getSecretStatusAction()).find((x) => x.name === "GROQ_API_KEY");
    expect(s).toMatchObject({ configured: true, source: "keychain" });
  });

  test("no value leaks in a response", async () => {
    await actions.setSecretAction("GROQ_API_KEY", "super-secret");
    const json = JSON.stringify(await actions.getSecretStatusAction());
    expect(json).not.toContain("super-secret");
  });

  test("clear removes the stored value", async () => {
    await actions.setSecretAction("GROQ_API_KEY", "sk-1");
    await actions.clearSecretAction("GROQ_API_KEY");
    const s = (await actions.getSecretStatusAction()).find((x) => x.name === "GROQ_API_KEY");
    expect(s?.source).toBe(process.env.GROQ_API_KEY ? "env" : "none");
  });

  test("regenerate service token changes the stored value and returns ok", async () => {
    await actions.setSecretAction("IG_SERVICE_TOKEN", "original-token");
    const before = (await actions.getSecretStatusAction()).find((x) => x.name === "IG_SERVICE_TOKEN");
    expect(before).toMatchObject({ configured: true, source: "keychain" });

    const result = await actions.regenerateServiceTokenAction();
    expect(result.ok).toBe(true);

    const token = getSecret("IG_SERVICE_TOKEN");
    expect(token).not.toBe("original-token");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });
});
