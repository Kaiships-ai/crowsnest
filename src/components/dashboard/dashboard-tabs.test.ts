import { describe, expect, test } from "vitest";
import { resolveDashboardTab } from "./dashboard-tabs";

describe("resolveDashboardTab (ACTION-17)", () => {
  test("overview, reels, calendar; anything else is overview", () => {
    expect([undefined, "reels", "calendar", "REELS", "x", ["reels"]].map((v) => resolveDashboardTab(v as string | undefined))).toEqual(["overview", "reels", "calendar", "overview", "overview", "overview"]);
  });
});
