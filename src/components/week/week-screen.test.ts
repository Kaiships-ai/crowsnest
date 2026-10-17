import { describe, expect, test } from "vitest";
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
