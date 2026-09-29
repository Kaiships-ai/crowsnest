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
