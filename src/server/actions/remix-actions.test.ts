import { beforeAll, expect, test } from "vitest";

let db: typeof import("../db")["db"];
let tables: typeof import("../db")["tables"];
let newId: typeof import("../db")["newId"];
let nowIso: typeof import("../db")["nowIso"];
let remix: typeof import("../services/remix");
let actions: typeof import("./remix-actions");

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("../db"));
  (await import("../db/test-migrate")).migrate();
  remix = await import("../services/remix");
  actions = await import("./remix-actions");
});

async function sessionWithOutline() {
  const channelId = newId();
  const videoId = newId();
  const now = nowIso();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@a-${channelId}`, trackedSince: now });
  await db.insert(tables.videos).values({
    id: videoId, channelId, platform: "instagram", externalId: `a-${videoId}`, url: "https://example.com/p", postedAt: now, firstSeenAt: now,
  });
  const session = await remix.getOrCreateSession(videoId);
  await remix.updateStage(session.id, { variants: ["one"], outline: { beats: [{ label: "Hook", content: "a", targetSec: 3 }] } });
  return session;
}

test("a malformed beat is refused and the outline stays readable", async () => {
  const session = await sessionWithOutline();
  const bad = { label: "Hook", content: "a" } as unknown as Parameters<typeof actions.editBeatAction>[2];

  expect((await actions.editBeatAction(session.id, 0, bad)).ok).toBe(false);
  expect((await remix.getOrCreateSession(session.sourceVideoId)).outline?.beats).toHaveLength(1);
});

test("a non-string variant is refused", async () => {
  const session = await sessionWithOutline();

  expect((await actions.editVariantAction(session.id, 0, 7 as unknown as string)).ok).toBe(false);
  expect((await remix.getOrCreateSession(session.sourceVideoId)).variants).toEqual(["one"]);
});

test("an edit the server could not apply is reported, not marked saved", async () => {
  const session = await sessionWithOutline();

  expect((await actions.editVariantAction(session.id, 3, "lost")).ok).toBe(false);
  expect((await actions.editBeatAction(session.id, 3, { label: "B", content: "b", targetSec: 1 })).ok).toBe(false);
});
