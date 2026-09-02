import { beforeAll, beforeEach, describe, expect, test } from "vitest";

// Same reasoning as src/server/queries/feed.test.ts: the db singleton binds
// CROWSNEST_DB_PATH at import, so it must be set before any dynamic import of
// "@/server/db" (or anything that imports it, including service-darwin.ts once this
// task lands).
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let setSecret: typeof import("@/server/secrets/store")["setSecret"];
let services: typeof import("./service-darwin")["services"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ setSecret } = await import("@/server/secrets/store"));
  ({ services } = await import("./service-darwin"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.secrets);
});

describe("services", () => {
  test("com.crowsnest.ig receives IG_USERNAME/IG_PASSWORD/IG_SERVICE_TOKEN from the secrets store", () => {
    setSecret("IG_USERNAME", "burner.acct");
    setSecret("IG_PASSWORD", "hunter2");

    const ig = services().find((s) => s.label === "com.crowsnest.ig");

    expect(ig?.env.IG_USERNAME).toBe("burner.acct");
    expect(ig?.env.IG_PASSWORD).toBe("hunter2");
    expect(ig?.env.IG_SERVICE_TOKEN).toBeTruthy();
  });

  test("a credential never saved through the dashboard is simply absent, never an empty string", () => {
    const ig = services().find((s) => s.label === "com.crowsnest.ig");

    expect(ig?.env.IG_USERNAME).toBeUndefined();
    expect(ig?.env.IG_PASSWORD).toBeUndefined();
  });

  test("com.crowsnest.server keeps its existing fixed env, untouched by this change", () => {
    const server = services().find((s) => s.label === "com.crowsnest.server");

    expect(server?.env).toEqual({ NODE_ENV: "production", HOST: "127.0.0.1", PORT: "3000" });
  });
});
