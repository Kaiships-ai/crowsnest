import { describe, expect, test, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("@/components/mine/calendar-tab", () => ({ CalendarTab: () => null }));
vi.mock("@/components/mine/my-reels-tab", () => ({ MyReelsTab: () => null }));
vi.mock("@/components/dashboard/overview-tab", () => ({ OverviewTab: () => null }));
vi.mock("@/components/layout/page-container", () => ({ PageContainer: () => null }));

describe("DashboardPage", () => {
  test("a repeated query param (?tab=reels&tab=x) reads its first value, not the array", async () => {
    const { default: DashboardPage } = await import("./page");
    const { MyReelsTab } = await import("@/components/mine/my-reels-tab");
    const page = (await DashboardPage({ searchParams: Promise.resolve({ tab: ["reels", "calendar"], reel: ["r1", "r2"], month: ["2026-09"] }) })) as ReactElement<{ children: ReactElement[] }>;
    const reels = page.props.children.find((c) => c && c.type === MyReelsTab) as ReactElement<{ reel?: string }> | undefined;
    expect(reels?.props.reel).toBe("r1");
  });
});
