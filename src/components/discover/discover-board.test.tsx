/**
 * @vitest-environment jsdom
 *
 * Same jsdom + @testing-library/react combination creator-seed-card.test.tsx uses.
 *
 * Regression coverage for the niche-filter round trip: switching away from and
 * back to a niche unmounts and remounts a CreatorSeedCard. Its own local follow
 * state does not survive that — DiscoverBoard has to remember the follow itself.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { CreatorSeedRow } from "@/server/queries/discover";

const mocks = vi.hoisted(() => ({
  followCreatorAction: vi.fn(),
}));

vi.mock("@/server/actions/discover-actions", () => mocks);
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { DiscoverBoard } from "./discover-board";

function seed(overrides: Partial<CreatorSeedRow> = {}): CreatorSeedRow {
  return {
    handle: "lift.laura",
    niche: "fitness",
    why: "Consistent form breakdowns that outperform the niche median.",
    source: null,
    tracked: false,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.followCreatorAction.mockReset();
});

afterEach(() => {
  cleanup();
});

test("a followed card stays Tracked after a niche-filter round trip unmounts and remounts it", async () => {
  mocks.followCreatorAction.mockResolvedValue({
    ok: true,
    syncQueued: true,
    alreadyTracked: false,
    channelId: "c1",
  });

  const seeds = [
    seed({ handle: "tech.tim", niche: "tech" }),
    seed({ handle: "lift.laura", niche: "fitness" }),
  ];

  render(<DiscoverBoard seeds={seeds} />);

  // Follow the tech creator while on "all".
  const rows = () => screen.getAllByTestId("creator-seed-card");
  const techButton = () =>
    rows()
      .find((row) => row.textContent?.includes("@tech.tim"))!
      .querySelector('[data-testid="creator-seed-follow"]') as HTMLButtonElement;

  await act(async () => {
    fireEvent.click(techButton());
  });

  expect(techButton().textContent).toBe("Đang theo dõi");

  // Switch to fitness: the tech card unmounts (destroying its local state).
  fireEvent.click(screen.getByRole("tab", { name: "fitness" }));
  expect(screen.queryByText("@tech.tim")).toBeNull();

  // Switch back to all: the tech card remounts.
  fireEvent.click(screen.getByRole("tab", { name: "tất cả" }));

  expect(techButton().textContent).toBe("Đang theo dõi");
  expect(techButton().disabled).toBe(true);
  // Only followed once, not re-invoked by the remount.
  expect(mocks.followCreatorAction).toHaveBeenCalledTimes(1);
});
