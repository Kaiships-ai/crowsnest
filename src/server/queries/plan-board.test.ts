import { beforeEach, expect, test } from "vitest";

import { movePlanCardAction } from "@/server/actions/plan-board-actions";
import { db, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import { getPlanBoard } from "./plan-board";

const NOW = new Date(2026, 10, 10, 9);
const T = "2026-10-01T00:00:00.000Z";
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("sv-SE");

beforeEach(async () => {
  migrate();
  for (const t of [tables.plannedPosts, tables.scripts, tables.videos, tables.channels]) await db.delete(t);
  await db.insert(tables.channels).values({ id: "ch", platform: "instagram", handle: "@rival", trackedSince: T, isOwn: false });
  await db.insert(tables.videos).values({ id: "v1", channelId: "ch", platform: "instagram", externalId: "v1", url: "https://www.instagram.com/reel/v1/", postedAt: T, firstSeenAt: T });
  await db.insert(tables.scripts).values({ id: "s1", title: "Hook script", content: "Line one.", createdAt: T, updatedAt: T });
});

const plan = (id: string, fields: Partial<typeof tables.plannedPosts.$inferInsert>) => ({ id, title: id, state: "scheduled", createdAt: T, updatedAt: T, ...fields });

test("the month grid is whole Monday weeks, each card on its day with its state and missing items", async () => {
  await db.insert(tables.plannedPosts).values([
    plan("full", { plannedDate: "2026-11-12", plannedTime: "19:30", scriptId: "s1", caption: "Cap", sourceVideoId: "v1" }),
    plan("bare", { state: "draft", plannedDate: "2026-11-12" }),
    plan("late", { plannedDate: "2026-11-03" }),
    plan("armed", { plannedDate: "2026-11-20", plannedTime: "19:30", scheduledAt: "2026-11-20T12:30:00.000Z" }),
    plan("done", { state: "published", plannedDate: "2026-11-01" }),
    plan("edge", { plannedDate: "2026-10-27" }),
    plan("next", { plannedDate: "2026-12-10" }),
    plan("undated", { state: "draft" }),
  ]);
  const board = await getPlanBoard("2026-11", NOW);
  expect([board.today, board.gridDays.length, board.gridDays[0].date, board.gridDays.at(-1)?.date]).toEqual(["2026-11-10", 42, "2026-10-26", "2026-12-06"]);
  const cards = board.gridDays.flatMap((d) => d.cards.map((c) => [d.date, d.inMonth, c.id, c.state, c.lockReason !== null]));
  expect(cards).toEqual([
    ["2026-10-27", false, "edge", "missed", false],
    ["2026-11-01", true, "done", "published", true],
    ["2026-11-03", true, "late", "missed", false],
    ["2026-11-12", true, "bare", "draft", false],
    ["2026-11-12", true, "full", "plan", false],
    ["2026-11-20", true, "armed", "scheduled", true],
  ]);
  const full = board.gridDays.flatMap((d) => d.cards).find((c) => c.id === "full")!;
  expect(full).toMatchObject({
    time: "19:30",
    script: { title: "Hook script", content: "Line one." },
    caption: "Cap",
    reference: { videoId: "v1", url: "https://www.instagram.com/reel/v1/", handle: "@rival" },
    missing: ["key", "gift", "offer"],
  });
  const bare = board.gridDays.flatMap((d) => d.cards).find((c) => c.id === "bare")!;
  expect(bare.missing).toEqual(["script", "caption", "reference", "time", "key", "gift", "offer"]);
});

test("a draft moves to another day; a reel scheduled with Instagram is refused with its reason and keeps its day", async () => {
  await db.insert(tables.plannedPosts).values([
    plan("draft", { state: "draft", plannedDate: day(2) }),
    plan("armed", { plannedDate: day(3), plannedTime: "19:30", scheduledAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), idempotencyKey: "armed:x" }),
  ]);
  expect(await movePlanCardAction("draft", day(5))).toMatchObject({ ok: true, prior: { plannedDate: day(2) } });
  expect(await movePlanCardAction("armed", day(5))).toEqual({ ok: false, error: "Đã hẹn đăng lên Instagram. Huỷ hẹn trước rồi mới dời ngày.", code: "PLAN_LOCKED" });
  const rows = await db.select({ id: tables.plannedPosts.id, date: tables.plannedPosts.plannedDate }).from(tables.plannedPosts).orderBy(tables.plannedPosts.id);
  expect(rows).toEqual([
    { id: "armed", date: day(3) },
    { id: "draft", date: day(5) },
  ]);
});
