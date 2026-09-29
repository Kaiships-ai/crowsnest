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
