import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// Same reasoning as src/server/queries/feed.test.ts: the db singleton binds
// CROWSNEST_DB_PATH at import, so it must be set before any dynamic import of
// "@/server/db" (or anything that imports it, including service-darwin.ts once this
// task lands).
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let setSecret: typeof import("@/server/secrets/store")["setSecret"];
let services: typeof import("./service-darwin")["services"];
let plist: typeof import("./service-darwin")["plist"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ setSecret } = await import("@/server/secrets/store"));
  ({ services, plist } = await import("./service-darwin"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.secrets);
});

describe("services", () => {
  test("com.crowsnest.ig receives IG_USERNAME/IG_PASSWORD/IG_SERVICE_TOKEN from the secrets store", async () => {
    setSecret("IG_USERNAME", "burner.acct");
    setSecret("IG_PASSWORD", "hunter2");

    const ig = (await services()).find((s) => s.label === "com.crowsnest.ig");

    expect(ig?.env.IG_USERNAME).toBe("burner.acct");
    expect(ig?.env.IG_PASSWORD).toBe("hunter2");
    expect(ig?.env.IG_SERVICE_TOKEN).toBeTruthy();
  });

  test("a credential never saved through the dashboard is simply absent, never an empty string", async () => {
    const ig = (await services()).find((s) => s.label === "com.crowsnest.ig");

    expect(ig?.env.IG_USERNAME).toBeUndefined();
    expect(ig?.env.IG_PASSWORD).toBeUndefined();
  });

  test("com.crowsnest.server keeps its existing fixed env, untouched by this change", async () => {
    const server = (await services()).find((s) => s.label === "com.crowsnest.server");

    expect(server?.env).toEqual({ NODE_ENV: "production", HOST: "127.0.0.1", PORT: "3000" });
  });
});

describe("plist XML-escapes injected values", () => {
  test("an IG_PASSWORD containing & < > renders as well-formed, escaped XML", async () => {
    setSecret("IG_USERNAME", "burner.acct");
    setSecret("IG_PASSWORD", "p@ss&<w>ord");

    const ig = (await services()).find((s) => s.label === "com.crowsnest.ig")!;
    const xml = plist(ig);

    // The raw secret must never appear unescaped in the rendered plist.
    expect(xml).not.toContain("p@ss&<w>ord");
    // Escaped entities for each special character in the password must be present.
    expect(xml).toContain("p@ss&amp;&lt;w&gt;ord");

    // Well-formedness: every "&" outside a known entity would break plist parsing.
    // Strip the entities this file emits and confirm no bare &, <, or > slipped
    // into a place that isn't a tag delimiter.
    const withoutEntities = xml.replace(/&(amp|lt|gt|quot|apos);/g, "");
    expect(withoutEntities).not.toContain("&");
    // Every "<" must open a real tag/doctype/decl (letter, /, !, or ?), never stray text.
    for (const m of withoutEntities.matchAll(/<(.)/g)) {
      expect(/[a-zA-Z/!?]/.test(m[1])).toBe(true);
    }
  });
});

// The bug this guards against: a static top-of-file `import ... from
// "../server/secrets/store"` would defeat `pinDbPathEnv()`, because ES module semantics
// fully evaluate an imported module (and its own imports, including "@/server/db",
// which opens the sqlite connection at import time) before *any* of the importing
// module's own top-level code runs, regardless of where the `import` line sits in the
// source. The suite above can't see this: it sets CROWSNEST_DB_PATH to ":memory:" in
// beforeAll before importing anything, so pinDbPathEnv() has nothing to do and the race
// never gets exercised.
//
// This test proves the ordering directly instead of via a side effect: it mocks
// "../server/secrets/store" (the exact specifier service-darwin.ts imports) to record
// the instant it is evaluated, then checks that importing "./service-darwin" alone
// does not evaluate it, and that only calling services() does. Against a regression to
// a static top-level import, the mock would already have fired by the first check,
// before services() is ever called.
describe("the secrets store loads lazily, after pinDbPathEnv() has already run", () => {
  test("importing service-darwin does not load the secrets store; calling services() does", async () => {
    const loadedAt: string[] = [];
    vi.doMock("../server/secrets/store", async (importOriginal) => {
      loadedAt.push("loaded");
      return importOriginal();
    });
    vi.resetModules();

    const fresh = await import("./service-darwin");
    expect(loadedAt).toEqual([]);

    // The fresh module's own db singleton is a brand-new, unmigrated ":memory:"
    // instance (vi.resetModules() cleared "@/server/db" too), so getOrCreateServiceToken
    // inside igEnv() throws "no such table: secrets". Irrelevant here: the mock factory
    // above has already run (and recorded "loaded") by the time that throw happens, so
    // only the ordering, never the credential values, is what this test checks.
    await fresh.services().catch(() => {});
    expect(loadedAt).toEqual(["loaded"]);

    vi.doUnmock("../server/secrets/store");
    vi.resetModules();
  });
});
