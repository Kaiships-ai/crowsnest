import { beforeAll, beforeEach, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let store: typeof import("./store");

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  store = await import("./store");
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.secrets);
});

describe("secrets store", () => {
  test("db value wins over env", () => {
    store.setSecret("GROQ_API_KEY", "db-value");
    process.env.GROQ_API_KEY = "env-value";
    expect(store.getSecret("GROQ_API_KEY")).toBe("db-value");
    delete process.env.GROQ_API_KEY;
  });

  test("env fallback when no db row", () => {
    process.env.GROQ_API_KEY = "env-value";
    expect(store.getSecret("GROQ_API_KEY")).toBe("env-value");
    delete process.env.GROQ_API_KEY;
  });

  test("undefined when neither set", () => {
    delete process.env.GROQ_API_KEY;
    expect(store.getSecret("GROQ_API_KEY")).toBeUndefined();
  });

  test("setSecret rejects empty", () => {
    expect(() => store.setSecret("GROQ_API_KEY", "   ")).toThrow();
  });

  test("clearSecret removes the db row (env still shows)", () => {
    store.setSecret("GROQ_API_KEY", "db-value");
    store.clearSecret("GROQ_API_KEY");
    process.env.GROQ_API_KEY = "env-value";
    expect(store.getSecret("GROQ_API_KEY")).toBe("env-value");
    delete process.env.GROQ_API_KEY;
  });

  test("status never returns values", () => {
    store.setSecret("GROQ_API_KEY", "db-value");
    const s = store.secretStatus().find((x) => x.name === "GROQ_API_KEY");
    expect(s).toEqual({ name: "GROQ_API_KEY", configured: true, source: "db" });
    expect(JSON.stringify(store.secretStatus())).not.toContain("db-value");
  });

  test("getOrCreateServiceToken generates once and is stable", () => {
    delete process.env.IG_SERVICE_TOKEN;
    const a = store.getOrCreateServiceToken();
    const b = store.getOrCreateServiceToken();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});
