import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { eq } from "drizzle-orm";

// B-04: editing a planned post fired up to four separate awaited action calls
// (fields, schedule, script, videoKind) with no shared transaction, so a failure
// partway through left a partial edit. savePlanEditAction validates everything
// first, then applies the whole edit in one transaction.

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let createPlannedPostAction: typeof import("./planned-post-actions")["createPlannedPostAction"];
let savePlanEditAction: typeof import("./planned-post-actions")["savePlanEditAction"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ createPlannedPostAction, savePlanEditAction } = await import("./planned-post-actions"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.plannedPosts);
});

async function makePlan(title = "Original title") {
  await createPlannedPostAction({ title });
  const [row] = await db.select().from(tables.plannedPosts).limit(1);
  return row;
}

describe("savePlanEditAction (B-04: a plan edit must not leave a partial edit on failure)", () => {
  test("a failing part (a script that does not exist) leaves every other field unchanged", async () => {
    const plan = await makePlan("Original title");

    // Edit the title AND attach a script that does not exist. Before the fix, the title
    // write had already committed by the time the script attach failed: a partial edit.
    const result = await savePlanEditAction(plan.id, { title: "Edited title", scriptId: "does-not-exist" });
    expect(result.ok).toBe(false);

    const [after] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, plan.id));
    expect(after.title).toBe("Original title"); // unchanged: the whole edit was rejected, not half-applied
  });

  test("a valid edit applies title, date, and note together in one call, and leaves the state alone", async () => {
    const plan = await makePlan();

    const result = await savePlanEditAction(plan.id, { title: "New title", note: "shot list", date: day(3) });
    expect(result.ok).toBe(true);

    const [after] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, plan.id));
    expect(after.title).toBe("New title");
    expect(after.note).toBe("shot list");
    expect(after.plannedDate).toBe(day(3));
    expect(after.state).toBe("draft");
  });
});

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("sv-SE");
const read = async (id: string) => (await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, id)))[0];

async function seed(fields: Partial<typeof tables.plannedPosts.$inferInsert>) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(tables.plannedPosts).values({ id, title: "Reel", state: "scheduled", createdAt: now, updatedAt: now, ...fields });
  return id;
}

describe("savePlanEditAction follows the move rules", () => {
  test("re-dating a failed reel keeps it failed with its error", async () => {
    const id = await seed({ state: "failed", plannedDate: day(1), plannedTime: "09:00", lastError: "boom", attemptCount: 1 });
    expect(await savePlanEditAction(id, { date: day(4) })).toEqual({ ok: true });
    expect(await read(id)).toMatchObject({ state: "failed", plannedDate: day(4), plannedTime: "09:00", lastError: "boom", attemptCount: 1 });
  });

  test("re-dating an armed reel shifts scheduledAt by the same days, keeps plannedTime, and re-keys it", async () => {
    const at = new Date(Date.now() + 86_400_000);
    at.setHours(10, 30, 0, 0);
    const id = await seed({ plannedDate: day(1), plannedTime: "10:30", scheduledAt: at.toISOString(), idempotencyKey: "old" });
    expect(await savePlanEditAction(id, { date: day(5) })).toEqual({ ok: true });
    const want = new Date(at.getTime());
    want.setDate(want.getDate() + 4);
    expect(await read(id)).toMatchObject({ state: "scheduled", plannedDate: day(5), plannedTime: "10:30", scheduledAt: want.toISOString(), idempotencyKey: `${id}:${want.toISOString()}` });
  });

  test("a past day is refused and nothing changes", async () => {
    const id = await seed({ plannedDate: day(1), plannedTime: "09:00" });
    const before = await read(id);
    expect(await savePlanEditAction(id, { title: "x", date: day(-2) })).toMatchObject({ ok: false, code: "PLAN_MOVE_TO_PAST" });
    expect(await read(id)).toEqual(before);
  });

  test("blanking the day of an armed reel disarms it back to draft", async () => {
    const id = await seed({ plannedDate: day(1), plannedTime: "09:00", scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), idempotencyKey: "k" });
    expect(await savePlanEditAction(id, { date: null })).toEqual({ ok: true });
    expect(await read(id)).toMatchObject({ state: "draft", plannedDate: null, scheduledAt: null, idempotencyKey: null });
  });

  test("published and publishing reels are refused with PLAN_LOCKED", async () => {
    for (const state of ["published", "publishing"]) {
      const id = await seed({ state, plannedDate: day(1) });
      expect(await savePlanEditAction(id, { title: "changed" })).toMatchObject({ ok: false, code: "PLAN_LOCKED" });
      expect((await read(id)).title).toBe("Reel");
    }
  });
});
