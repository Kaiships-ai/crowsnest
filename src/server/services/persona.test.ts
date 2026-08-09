import { beforeAll, describe, expect, test } from "vitest";

let db: typeof import("../db")["db"];
let tables: typeof import("../db")["tables"];
let migrate: typeof import("../db/test-migrate")["migrate"];
let saveNicheSettingsAction: typeof import("../actions/settings-actions")["saveNicheSettingsAction"];
let getPersona: typeof import("./persona")["getPersona"];
let upsertPersona: typeof import("./persona")["upsertPersona"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables } = await import("../db"));
  ({ migrate } = await import("../db/test-migrate"));
  ({ saveNicheSettingsAction } = await import("../actions/settings-actions"));
  ({ getPersona, upsertPersona } = await import("./persona"));
});

describe("getPersona", () => {
  test("seeds audience from the niche profile on first read", async () => {
    migrate();
    await db.delete(tables.appSettings);
    await db.delete(tables.persona);
    await saveNicheSettingsAction("AI tools and building-in-public for solo founders", []);

    const p = await getPersona();

    expect(p.audience).toContain("building-in-public");
    expect(p.voice).toBe("");
  });
});

describe("upsertPersona", () => {
  test("persists and getPersona returns it", async () => {
    migrate();
    await db.delete(tables.appSettings);
    await db.delete(tables.persona);

    await upsertPersona({ voice: "short, dry, specific" });

    expect((await getPersona()).voice).toBe("short, dry, specific");
  });
});
