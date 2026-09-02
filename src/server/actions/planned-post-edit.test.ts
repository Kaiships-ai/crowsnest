import { beforeAll, beforeEach, describe, expect, test } from "vitest";
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

  test("a valid edit applies title, date, and note together in one call", async () => {
    const plan = await makePlan();

    const result = await savePlanEditAction(plan.id, { title: "New title", note: "shot list", date: "2026-10-01" });
    expect(result.ok).toBe(true);

    const [after] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, plan.id));
    expect(after.title).toBe("New title");
    expect(after.note).toBe("shot list");
    expect(after.plannedDate).toBe("2026-10-01");
    expect(after.state).toBe("scheduled");
  });
});
