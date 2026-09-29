/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
afterEach(cleanup);

const { OwnStatTiles } = await import("./own-stat-tiles");
const { GraphConnectPanel } = await import("./graph-connect-panel");

describe("B-16 testids", () => {
  test("six stat tiles and the connect panel with its check button", () => {
    const metric = { value: 1, sampleSize: 1, failedSampleSize: 0, wired: true };
    const overview = { account: { username: "me", followerCount: 1, followsCount: 1, mediaCount: 1, measuredAt: "2026-09-01T00:00:00.000Z" }, windowDays: 30, postsInWindow: 1, postsMeasured: 1, metrics: { reach: metric, saved: metric, shares: metric, profileVisits: metric, followsFromPost: metric, watchTimeSec: metric }, medianReach: null, medianSampleSize: 1 };
    const { container } = render(<OwnStatTiles overview={overview} />);
    expect(container.querySelectorAll('[data-testid="mine-stat-tile"]')).toHaveLength(6);
    const panel = render(<GraphConnectPanel ownHandle="@me" everMeasured initialStatus={{ configured: true, username: null, state: "auth_failed", message: null, checkedAt: "2026-09-01T00:00:00.000Z" }} />);
    expect(panel.container.querySelector('[data-testid="mine-connect-panel"]')).toBeTruthy();
    expect(panel.container.querySelector('[data-testid="mine-connect-check"]')).toBeTruthy();
  });
});

const { ReelPicker } = await import("./reel-picker");
describe("ReelPicker", () => {
  test("one link per reel setting ?reel=, the selected one marked current", () => {
    const reels = ["r3", "r2", "r1"].map((id) => ({ ownPostId: id, postedAt: "2026-09-20T00:00:00.000Z", views: 1200, thumbnailUrl: null, caption: id }));
    const { container } = render(<ReelPicker reels={reels} selectedId="r2" />);
    const items = container.querySelectorAll('[data-testid="reels-picker-item"]');
    expect(items).toHaveLength(3);
    expect(items[1].getAttribute("href")).toBe("/?tab=reels&reel=r2");
    expect(items[1].getAttribute("aria-current")).toBe("true");
    expect(items[0].getAttribute("data-id")).toBe("r3");
  });
  test("empty state says so", () => {
    const { getByText } = render(<ReelPicker reels={[]} selectedId={null} />);
    expect(getByText(/No reels measured yet/)).toBeTruthy();
  });
});

const { ReelInsightPanel } = await import("./reel-insight-panel");
const { shapeReelInsights } = await import("@/server/services/reel-insights");
const SNAP = { capturedAt: "2026-09-29T10:00:00.000Z", views: 120000, reach: 80997, likes: 900, comments: 40, shares: 1112, saved: 300, reposts: 20, followsFromPost: 12, profileVisits: 50, bioLinkTaps: 7, avgWatchTimeMs: 4500, skipRate: 42.1, fetchError: null };
describe("ReelInsightPanel", () => {
  test("E2E-17 counts, 1.4% share rate, estimated skip rate", () => {
    const { container, getByText } = render(<ReelInsightPanel insights={shapeReelInsights(SNAP)} points={[]} />);
    const count = (id: string) => container.querySelectorAll(`[data-testid="${id}"]`).length;
    expect([count("reels-summary-tile"), count("reels-interaction"), count("reels-impact-row"), count("reels-action-row"), count("reels-unavailable"), count("reels-measured-at")]).toEqual([4, 5, 6, 3, 3, 1]);
    expect(getByText("1.4%")).toBeTruthy();
    expect(getByText("estimated")).toBeTruthy();
    expect(getByText("4.5s")).toBeTruthy();
  });
  test("E2E-23: reach 0 renders dashes, never 0%", () => {
    const { container } = render(<ReelInsightPanel insights={shapeReelInsights({ ...SNAP, reach: 0 })} points={[]} />);
    const rows = [...container.querySelectorAll('[data-testid="reels-impact-row"]')].slice(1);
    expect(rows.every((r) => r.textContent?.includes("—") && !r.textContent.includes("0%"))).toBe(true);
  });
});

const { ReelViewsOverTime } = await import("./reel-views-over-time");
describe("ReelViewsOverTime", () => {
  test("chart card with the typical-reel legend", () => {
    const { container, getByText } = render(<ReelViewsOverTime points={[{ hour: 1, views: 100, typical: 70 }]} />);
    expect(container.querySelector('[data-testid="reels-views-chart"]')).toBeTruthy();
    expect(getByText("Your typical reel")).toBeTruthy();
  });
  test("no points: says so instead of an empty chart", () => {
    const { getByText } = render(<ReelViewsOverTime points={[]} />);
    expect(getByText(/Not enough measurements yet/)).toBeTruthy();
  });
});
