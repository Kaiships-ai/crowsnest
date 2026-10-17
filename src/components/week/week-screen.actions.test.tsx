/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { WeekScreenProps } from "./week-screen";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/components/mine/publish-dialog", () => ({ PublishDialog: () => null }));
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
});
