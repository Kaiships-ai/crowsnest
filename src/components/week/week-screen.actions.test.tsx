/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { WeekScreenProps } from "./week-screen";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/components/mine/publish-dialog", () => ({ PublishDialog: () => null }));
const toasts = vi.hoisted(() => [] as { msg: string; action?: { onClick: () => unknown } }[]);
vi.mock("sonner", () => {
  const push = (msg: string, opts?: { action?: { onClick: () => unknown } }) => void toasts.push({ msg, action: opts?.action });
  return { toast: { success: push, error: push, info: push } };
});
vi.stubGlobal(
  "EventSource",
  class {
    close() {}
  }
);

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let getPlannedPosts: typeof import("@/server/queries/planned-posts")["getPlannedPosts"];
let WeekScreen: typeof import("./week-screen")["WeekScreen"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ getPlannedPosts } = await import("@/server/queries/planned-posts"));
  ({ WeekScreen } = await import("./week-screen"));
  (await import("@/server/db/test-migrate")).migrate();
});

beforeEach(async () => {
  await db.delete(tables.plannedPosts);
  await db.delete(tables.remixSessions);
});
afterEach(cleanup);

const today = new Date().toLocaleDateString("sv-SE");
const plus = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("sv-SE");

async function seedSession(topic: string): Promise<string> {
  const channelId = newId();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@c-${channelId}`, trackedSince: nowIso() });
  const videoId = newId();
  await db.insert(tables.videos).values({ id: videoId, channelId, platform: "instagram", externalId: `x-${videoId}`, url: "https://example.com/p", postedAt: nowIso(), firstSeenAt: nowIso() });
  const id = newId();
  await db.insert(tables.remixSessions).values({ id, sourceVideoId: videoId, stage: "prompt", topic, createdAt: nowIso(), updatedAt: nowIso() });
  return id;
}

async function seedPlan(fields: Partial<typeof tables.plannedPosts.$inferInsert> = {}): Promise<string> {
  const id = newId();
  await db.insert(tables.plannedPosts).values({ id, title: "Reel", state: "scheduled", plannedDate: today, plannedTime: "09:00", createdAt: nowIso(), updatedAt: nowIso(), ...fields });
  return id;
}

async function renderWeek(over: Partial<WeekScreenProps> = {}) {
  const reels = await getPlannedPosts({ from: plus(-7), to: plus(7) });
  render(
    <WeekScreen
      today={today}
      weekKey="2026-W42"
      liveVersion={null}
      draft={null}
      reels={reels}
      funnel={{}}
      metrics={[]}
      graphConfigured
      bucketConfigured
      dryRun
      hooks={{}}
      hookTopics={{}}
      sourceGone={[]}
      hookTemplates={[]}
      scripts={[]}
      runs={[]}
      {...over}
    />
  );
  fireEvent.click(screen.getAllByTestId("week-today-card")[0]);
}

const row = async (id: string) => (await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, id)))[0];

describe("week drawer against the real actions", () => {
  test("a note typed then closed with Esc is saved", async () => {
    const id = await seedPlan();
    await renderWeek();
    fireEvent.change(screen.getByTestId("week-note-input"), { target: { value: "quay lại cảnh 2" } });
    fireEvent.keyDown(screen.getByTestId("week-drawer"), { key: "Escape" });
    await waitFor(async () => expect((await row(id)).note).toBe("quay lại cảnh 2"));
  });

  test("a hook template fills {topic} from the session; an unknown slot stays in the input unsaved", async () => {
    const s = await seedSession("giá nhà");
    await seedPlan({ remixSessionId: s });
    const templates = [
      { id: "a", title: "A", text: "Vì sao {topic} tăng" },
      { id: "b", title: "B", text: "Ba điều về {product}" },
    ];
    await renderWeek({ hooks: { [s]: null }, hookTopics: { [s]: "giá nhà" }, hookTemplates: templates });
    const hook = async () => (await db.select().from(tables.remixSessions).where(eq(tables.remixSessions.id, s)))[0].chosenHook;

    fireEvent.click(screen.getAllByTestId("week-hook-template")[0]);
    await waitFor(async () => expect(await hook()).toBe("Vì sao giá nhà tăng"));

    fireEvent.click(screen.getAllByTestId("week-hook-template")[1]);
    expect((screen.getByTestId("week-hook-input") as HTMLInputElement).value).toBe("Ba điều về {product}");
    fireEvent.blur(screen.getByTestId("week-hook-input"));
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(await hook()).toBe("Vì sao giá nhà tăng");
  });

  test("the day select moves a failed reel and keeps it failed; past days are not offered", async () => {
    const id = await seedPlan({ state: "failed", lastError: "boom" });
    await renderWeek();
    const select = screen.getByTestId("week-move-select") as HTMLSelectElement;
    expect([...select.options].every((o) => o.value >= today)).toBe(true);
    fireEvent.change(select, { target: { value: plus(1) } });
    await waitFor(async () => expect(await row(id)).toMatchObject({ plannedDate: plus(1), state: "failed", lastError: "boom" }));
  });

  test("cancel a scheduled publish: confirm, then the reel is a draft on its day and time, unarmed", async () => {
    const id = await seedPlan({ scheduledAt: new Date(Date.now() + 3_600_000).toISOString(), idempotencyKey: "k", videoAssetId: null, caption: "c" });
    await renderWeek();
    fireEvent.click(screen.getByTestId("week-cancel-publish"));
    expect((await row(id)).scheduledAt).not.toBeNull();
    fireEvent.click(screen.getByTestId("week-cancel-confirm-confirm"));
    await waitFor(async () => expect(await row(id)).toMatchObject({ state: "draft", plannedDate: today, plannedTime: "09:00", scheduledAt: null, idempotencyKey: null }));
  });

  test("retry a failed publish re-arms it", async () => {
    const id = await seedPlan({ state: "failed", lastError: "boom", attemptCount: 1 });
    await renderWeek();
    expect(screen.queryByTestId("week-publish")).toBeNull();
    fireEvent.click(screen.getByTestId("week-retry"));
    await waitFor(async () => expect(await row(id)).toMatchObject({ state: "scheduled", lastError: null }));
  });

  test("delete then Undo puts back every column of a failed reel", async () => {
    const id = await seedPlan({ state: "failed", note: "giữ", caption: "cap", keyword: "GIA", magnetUrl: "https://x.test/g", lastError: "boom", errorClass: "timeout", attemptCount: 2, createdAt: "2026-01-02T03:04:05.000Z" });
    const before = await row(id);
    await renderWeek();
    toasts.length = 0;
    fireEvent.click(screen.getByTestId("week-delete"));
    await waitFor(async () => expect(await row(id)).toBeUndefined());
    const undo = toasts.find((t) => t.msg === "Đã xoá reel")!.action!;
    await act(async () => void (await undo.onClick()));
    expect(await row(id)).toEqual(before);
  });

  test("a failed reel at the attempt cap shows why instead of a retry button", async () => {
    await seedPlan({ state: "failed", lastError: "x".repeat(300), attemptCount: 3 });
    await renderWeek();
    expect(screen.queryByTestId("week-retry")).toBeNull();
    expect(screen.getByTestId("week-retry-exhausted").textContent).toMatch(/hết lượt thử lại/);
  });

  test("Sửa plan saves a new title through savePlanEditAction", async () => {
    const id = await seedPlan({ remixSessionId: await seedSession("x") });
    await renderWeek();
    fireEvent.click(screen.getByTestId("week-edit"));
    const title = screen.getByDisplayValue("Reel");
    fireEvent.change(title, { target: { value: "Reel mới" } });
    fireEvent.click(screen.getByRole("button", { name: /lưu thay đổi/i }));
    await waitFor(async () => expect((await row(id)).title).toBe("Reel mới"));
  });
});
