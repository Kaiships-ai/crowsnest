/**
 * @vitest-environment jsdom
 *
 * Same jsdom + @testing-library/react combination failure-strip.test.tsx uses: this
 * component owns real state transitions (idle → pending → tracked) driven by a mocked
 * server action, not just static props.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { CreatorSeedRow } from "@/server/queries/discover";

const mocks = vi.hoisted(() => ({
  followCreatorAction: vi.fn(),
}));

vi.mock("@/server/actions/discover-actions", () => mocks);
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { CreatorSeedCard } from "./creator-seed-card";

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

test("Follow transitions to a queued state then Tracked, and disables", async () => {
  let resolveAction!: (value: { ok: true; syncQueued: boolean; alreadyTracked: boolean; channelId: string }) => void;
  mocks.followCreatorAction.mockReturnValue(
    new Promise((resolve) => {
      resolveAction = resolve;
    })
  );

  render(<CreatorSeedCard seed={seed()} />);

  const button = screen.getByTestId("creator-seed-follow") as HTMLButtonElement;
  expect(button.textContent).toBe("Follow");
  expect(button.disabled).toBe(false);

  fireEvent.click(button);

  expect(button.textContent).toBe("Queuing…");
  expect(button.disabled).toBe(true);

  await act(async () => {
    resolveAction({ ok: true, syncQueued: true, alreadyTracked: false, channelId: "c1" });
  });

  expect(button.textContent).toBe("Tracked");
  expect(button.disabled).toBe(true);
  expect(mocks.followCreatorAction).toHaveBeenCalledWith("lift.laura");
});

test("calls onFollowed with the handle after a successful follow", async () => {
  mocks.followCreatorAction.mockResolvedValue({
    ok: true,
    syncQueued: true,
    alreadyTracked: false,
    channelId: "c1",
  });
  const onFollowed = vi.fn();

  render(<CreatorSeedCard seed={seed()} onFollowed={onFollowed} />);

  await act(async () => {
    fireEvent.click(screen.getByTestId("creator-seed-follow"));
  });

  expect(onFollowed).toHaveBeenCalledWith("lift.laura");
});

test("does not call onFollowed when the follow fails", async () => {
  mocks.followCreatorAction.mockResolvedValue({ ok: false, error: "nope" });
  const onFollowed = vi.fn();

  render(<CreatorSeedCard seed={seed()} onFollowed={onFollowed} />);

  await act(async () => {
    fireEvent.click(screen.getByTestId("creator-seed-follow"));
  });

  expect(onFollowed).not.toHaveBeenCalled();
});

test("a rejected server action resets the button to Follow instead of freezing on Queuing…", async () => {
  mocks.followCreatorAction.mockRejectedValue(new Error("transport blew up"));
  const onFollowed = vi.fn();

  render(<CreatorSeedCard seed={seed()} onFollowed={onFollowed} />);

  const button = screen.getByTestId("creator-seed-follow") as HTMLButtonElement;
  await act(async () => {
    fireEvent.click(button);
  });

  // Without the try/catch the button would stay disabled on "Queuing…" forever.
  expect(button.textContent).toBe("Follow");
  expect(button.disabled).toBe(false);
  expect(onFollowed).not.toHaveBeenCalled();
});

test("a tracked seed renders disabled Tracked from the start", () => {
  render(<CreatorSeedCard seed={seed({ tracked: true })} />);

  const button = screen.getByTestId("creator-seed-follow") as HTMLButtonElement;
  expect(button.textContent).toBe("Tracked");
  expect(button.disabled).toBe(true);
  expect(mocks.followCreatorAction).not.toHaveBeenCalled();
});

describe("card and niche badge stay neutral", () => {
  test("renders handle, niche badge, and why text from the query row only", () => {
    render(<CreatorSeedCard seed={seed({ handle: "biz.ben", niche: "business", why: "Sharp thread breakdowns." })} />);

    const card = screen.getByTestId("creator-seed-card");
    expect(card.textContent).toContain("@biz.ben");
    expect(card.textContent).toContain("business");
    expect(card.textContent).toContain("Sharp thread breakdowns.");
  });
});
