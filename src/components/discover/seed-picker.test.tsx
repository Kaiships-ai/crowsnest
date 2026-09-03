/**
 * @vitest-environment jsdom
 *
 * Same jsdom + @testing-library/react combination creator-seed-card.test.tsx uses.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { CreatorSeedRow } from "@/server/queries/discover";

const mocks = vi.hoisted(() => ({
  followCreatorAction: vi.fn(),
}));

vi.mock("@/server/actions/discover-actions", () => mocks);

import { SeedPicker } from "./seed-picker";

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

function manySeeds(count: number): CreatorSeedRow[] {
  return Array.from({ length: count }, (_, i) => seed({ handle: `creator${i}`, niche: "fitness" }));
}

beforeEach(() => {
  mocks.followCreatorAction.mockReset();
});

afterEach(() => {
  cleanup();
});

test("selecting two seeds and following calls onDone with the resulting channel ids", async () => {
  mocks.followCreatorAction.mockImplementation((handle: string) =>
    Promise.resolve({ ok: true, channelId: `channel-${handle}`, syncQueued: true, alreadyTracked: false })
  );

  const seeds = [seed({ handle: "lift.laura" }), seed({ handle: "biz.ben", niche: "business" })];
  const onDone = vi.fn();

  render(<SeedPicker seeds={seeds} onDone={onDone} />);

  fireEvent.click(screen.getByTestId("seed-picker-checkbox-lift.laura"));
  fireEvent.click(screen.getByTestId("seed-picker-checkbox-biz.ben"));

  const followButton = screen.getByTestId("seed-picker-follow-selected") as HTMLButtonElement;
  expect(followButton.disabled).toBe(false);

  await act(async () => {
    fireEvent.click(followButton);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mocks.followCreatorAction).toHaveBeenCalledWith("lift.laura");
  expect(mocks.followCreatorAction).toHaveBeenCalledWith("biz.ben");
  expect(onDone).toHaveBeenCalledWith(["channel-lift.laura", "channel-biz.ben"]);
});

describe("maxSelect enforcement", () => {
  test("with maxSelect=10 and more than 10 seeds, an 11th selection is blocked", () => {
    const seeds = manySeeds(11);

    render(<SeedPicker seeds={seeds} maxSelect={10} />);

    for (let i = 0; i < 10; i++) {
      fireEvent.click(screen.getByTestId(`seed-picker-checkbox-creator${i}`));
    }

    const eleventh = screen.getByTestId("seed-picker-checkbox-creator10");
    fireEvent.click(eleventh);

    // The 11th checkbox never becomes checked, and stays disabled once the cap is hit.
    expect(eleventh.getAttribute("aria-checked")).toBe("false");
    expect(eleventh.getAttribute("aria-disabled")).toBe("true");

    const followButton = screen.getByTestId("seed-picker-follow-selected");
    expect(followButton.textContent).toContain("(10)");
  });
});
