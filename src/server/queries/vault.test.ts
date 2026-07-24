import { beforeAll, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let getVaultItems: typeof import("./vault")["getVaultItems"];
let getScripts: typeof import("./vault")["getScripts"];
let getVaultedVideoCounts: typeof import("./vault")["getVaultedVideoCounts"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ getVaultItems, getScripts, getVaultedVideoCounts } = await import("./vault"));
});

// Deterministic, strictly-increasing timestamps (not Date.now() — several inserts can
// otherwise land in the same millisecond and make desc-by-createdAt ordering flaky).
function tsAt(minutesAgo: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, minutesAgo)).toISOString();
}

describe("vault queries", () => {
  test("getVaultItems / getScripts / getVaultedVideoCounts: 6 vault items, filter by type, source chip join, scripts list", async () => {
    migrate();
    const channelId = newId();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: "@vault-test", trackedSince: tsAt(0) });

    const videoId = newId();
    await db.insert(tables.videos).values({
      id: videoId, channelId, platform: "instagram", externalId: `vault-src-${videoId}`,
      url: "https://example.com/source", postedAt: tsAt(0), firstSeenAt: tsAt(0),
    });

    // 3 hooks (2 with a source video, 1 manual) + 3 styles (2 with a source video, 1 manual) = 6.
    const hookIds = [newId(), newId(), newId()];
    const styleIds = [newId(), newId(), newId()];
    await db.insert(tables.vaultItems).values([
      { id: hookIds[0], type: "hook", sourceVideoId: videoId, title: "Curiosity Gap Hook", templateText: "the {topic} nobody talks about", tags: ["curiosity"], createdAt: tsAt(10) },
      { id: hookIds[1], type: "hook", sourceVideoId: null, title: "Results-First Hook", templateText: "how this {format} got {result}", tags: ["proof"], createdAt: tsAt(20) },
      { id: hookIds[2], type: "hook", sourceVideoId: videoId, title: "Negative Warning Hook", templateText: "you're falling behind on {topic}", tags: ["warning"], createdAt: tsAt(30) },
      { id: styleIds[0], type: "style", sourceVideoId: videoId, title: "Fast-Cut Listicle", templateText: "5 beats, CTA at end", tags: ["editing"], createdAt: tsAt(40) },
      { id: styleIds[1], type: "style", sourceVideoId: null, title: "Screen-Record Walkthrough", templateText: "voiceover, chapter captions", tags: ["tutorial"], createdAt: tsAt(50) },
      { id: styleIds[2], type: "style", sourceVideoId: videoId, title: "Talking-Head Teardown", templateText: "on-screen text callouts", tags: ["talking-head"], createdAt: tsAt(60) },
    ]);

    // -- getVaultItems: no filter returns all 6, newest first --
    const all = await getVaultItems();
    expect(all).toHaveLength(6);
    expect(all.map((v) => v.id)).toEqual([styleIds[2], styleIds[1], styleIds[0], hookIds[2], hookIds[1], hookIds[0]]);

    // -- filter by type --
    const hooks = await getVaultItems("hook");
    expect(hooks).toHaveLength(3);
    expect(hooks.every((v) => v.type === "hook")).toBe(true);
    expect(hooks.map((v) => v.id)).toEqual([hookIds[2], hookIds[1], hookIds[0]]);

    const styles = await getVaultItems("style");
    expect(styles).toHaveLength(3);
    expect(styles.every((v) => v.type === "style")).toBe(true);

    // -- source chip join --
    const sourced = all.find((v) => v.id === hookIds[0])!;
    expect(sourced.sourceVideo).toEqual({ videoId, channelHandle: "@vault-test" });
    expect(sourced.tags).toEqual(["curiosity"]);
    const manual = all.find((v) => v.id === hookIds[1])!;
    expect(manual.sourceVideo).toBeNull();

    // -- getVaultedVideoCounts: 4 of the 6 items point at `videoId` --
    const counts = await getVaultedVideoCounts();
    expect(counts.get(videoId)).toBe(4);

    // -- getScripts: source chip + hook/style titles resolved by id --
    const scriptId = newId();
    await db.insert(tables.scripts).values({
      id: scriptId,
      title: "Draft Script",
      content: "HOOK: ...\nBUILD: ...",
      sourceVideoId: videoId,
      hookVaultItemId: hookIds[0],
      styleVaultItemId: styleIds[0],
      status: "draft",
      createdAt: tsAt(70),
      updatedAt: tsAt(70),
    });

    const scripts = await getScripts();
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatchObject({
      id: scriptId,
      title: "Draft Script",
      status: "draft",
      sourceVideo: { videoId, channelHandle: "@vault-test" },
      hookTitle: "Curiosity Gap Hook",
      styleTitle: "Fast-Cut Listicle",
    });
  });

  test("getScripts: a script with no source video / no hook or style still resolves (nulls, not a crash)", async () => {
    migrate();
    const scriptId = newId();
    await db.insert(tables.scripts).values({
      id: scriptId,
      title: "Standalone Script",
      content: "just a draft",
      status: "draft",
      createdAt: tsAt(100),
      updatedAt: tsAt(100),
    });

    const scripts = await getScripts();
    const row = scripts.find((s) => s.id === scriptId)!;
    expect(row.sourceVideo).toBeNull();
    expect(row.hookTitle).toBeNull();
    expect(row.styleTitle).toBeNull();
  });
});
