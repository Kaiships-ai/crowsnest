/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { PlannedPostRow } from "@/server/queries/planned-posts";
import { WeekScreen, type WeekScreenProps } from "./week-screen";
import { isoWeekKey, moveReel, nextAction, reelStatus, splitWeek, stepsDone, weekDays, type WeekReel } from "./week-model";

const reel = (over: Partial<WeekReel>): WeekReel => ({
  id: "r",
  title: "Reel",
  note: null,
  state: "scheduled",
  plannedDate: "2026-10-19",
  plannedTime: "08:00",
  scriptId: null,
  scriptTitle: null,
  videoAssetId: null,
  caption: null,
  keyword: null,
  dryRun: false,
  lastError: null,
  publishedAt: null,
  ...over,
});

describe("week model", () => {
  test("week days run Monday to Sunday and the ISO key matches", () => {
    expect(weekDays("2026-10-21")).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(isoWeekKey("2026-10-25")).toBe("2026-W43");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
  });

  test("today and week split keeps two reels on one day, sorted by time", () => {
    const rs = [reel({ id: "b", plannedTime: "19:00" }), reel({ id: "a" }), reel({ id: "c", plannedDate: "2026-10-20" }), reel({ id: "x", plannedDate: "2026-11-02" })];
    const s = splitWeek(rs, "2026-10-19");
    expect(s.today.map((r) => r.id)).toEqual(["a", "b"]);
    expect(s.days).toHaveLength(6);
    expect(s.days[0].reels.map((r) => r.id)).toEqual(["c"]);
    expect(s.days.flatMap((d) => d.reels).some((r) => r.id === "x")).toBe(false);
  });

  test("next action prefers the publish gate, then the draft, then a failed publish, then a missing video", () => {
    const needsVideo = reel({ id: "v", scriptId: "s" });
    const failed = reel({ id: "f", state: "failed", videoAssetId: "a", caption: "c" });
    const gate = reel({ id: "g", videoAssetId: "a", caption: "c" });
    const draft = { id: "d", version: 3, diff: "" };
    expect(nextAction([needsVideo, failed, gate], draft)?.target).toEqual({ kind: "reel", id: "g" });
    expect(nextAction([needsVideo, failed], draft)?.target).toEqual({ kind: "draft" });
    expect(nextAction([needsVideo, failed], null)?.target).toEqual({ kind: "reel", id: "f" });
    expect(nextAction([needsVideo], null)?.label).toBe("Làm video: Reel");
    expect(nextAction([reel({ state: "published" })], null)).toBeNull();
  });

  test("a dry run never reads as a plain publish", () => {
    expect(reelStatus(reel({ state: "published", dryRun: true }), true)[0]).toBe("Đã đăng (dry run)");
    expect(reelStatus(reel({ state: "published" }), false)[0]).toBe("Đã đăng · chờ số 48h");
  });

  test("steps count in order and stop at the first open one", () => {
    expect(stepsDone(reel({}), true)).toBe(1);
    expect(stepsDone(reel({ scriptId: "s", videoAssetId: "a", state: "published" }), true)).toBe(5);
    expect(stepsDone(reel({ videoAssetId: "a" }), false)).toBe(1);
  });

  test("a move and its undo round-trip", () => {
    const rs = [reel({ id: "a" })];
    const moved = moveReel(rs, "a", "2026-10-22");
    expect(moved[0].plannedDate).toBe("2026-10-22");
    expect(moveReel(moved, "a", "2026-10-19")).toEqual(rs);
  });
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/server/actions/planned-post-actions", () => ({}));
vi.mock("@/server/actions/remix-actions", () => ({}));
vi.mock("@/components/mine/publish-dialog", () => ({ PublishDialog: () => null }));
vi.stubGlobal(
  "EventSource",
  class {
    close() {}
  }
);
afterEach(cleanup);

const plan = (over: Partial<PlannedPostRow>) => ({ ...reel({}), remixSessionId: null, sourceVideoId: null, ...over }) as PlannedPostRow;

function screenProps(reels: PlannedPostRow[], over: Partial<WeekScreenProps> = {}): WeekScreenProps {
  return {
    today: "2026-10-21",
    weekKey: "2026-W43",
    liveVersion: 1,
    draft: null,
    reels,
    funnel: {},
    metrics: [{ source: "chatbotx", metric: "dms" }],
    graphConfigured: true,
    bucketConfigured: true,
    dryRun: true,
    hooks: {},
    sourceGone: [],
    hookTemplates: [],
    runs: [],
    ...over,
  };
}

describe("week screen", () => {
  const reels = [
    plan({ id: "t1", title: "Hôm nay một", plannedDate: "2026-10-21", state: "published", dryRun: true }),
    plan({ id: "t2", title: "Hôm nay hai", plannedDate: "2026-10-21", plannedTime: "19:00" }),
    plan({ id: "w1", title: "Thứ năm", plannedDate: "2026-10-23" }),
  ];

  test("today shows its reels as cards, the dry run reads as one, and the week stays collapsed", () => {
    render(<WeekScreen {...screenProps(reels)} />);
    const today = within(screen.getByTestId("week-today"));
    expect(today.getAllByTestId("week-today-card").map((c) => c.dataset.reelId)).toEqual(["t1", "t2"]);
    expect(today.getByText("Đã đăng (dry run)")).toBeTruthy();
    expect(screen.queryByTestId("week-row")).toBeNull();

    fireEvent.click(screen.getByTestId("week-toggle"));
    expect(screen.getAllByTestId("week-row").map((r) => r.dataset.reelId)).toEqual(["w1"]);
  });

  test("a reel with no linked remix session shows an empty hook step with one way out", () => {
    render(<WeekScreen {...screenProps(reels)} />);
    fireEvent.click(screen.getAllByTestId("week-today-card")[1]);
    expect(screen.getByTestId("week-hook-empty")).toBeTruthy();
    expect(screen.queryByTestId("week-hook-input")).toBeNull();
    expect(screen.getByTestId("week-move-select")).toBeTruthy();
  });

  test("a linked session's chosen hook fills the hook input", () => {
    const linked = [plan({ id: "t2", title: "Có hook", plannedDate: "2026-10-21", remixSessionId: "s1" })];
    render(<WeekScreen {...screenProps(linked, { hooks: { s1: "Hook thật" } })} />);
    fireEvent.click(screen.getByTestId("week-today-card"));
    expect((screen.getByTestId("week-hook-input") as HTMLInputElement).value).toBe("Hook thật");
  });
});
