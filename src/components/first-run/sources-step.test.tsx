/**
 * @vitest-environment jsdom
 *
 * Covers the SeedPicker mount in the first-run sources step: following a curated creator
 * is enough to continue (no manual handle required), and seed-followed channel ids are
 * carried through Continue alongside any manually added handles, deduped.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { CreatorSeedRow } from "@/server/queries/discover";

const mocks = vi.hoisted(() => ({
  addChannelAction: vi.fn(),
  followCreatorAction: vi.fn(),
}));

vi.mock("@/server/actions/sync-actions", () => ({ addChannelAction: mocks.addChannelAction }));
vi.mock("@/server/actions/discover-actions", () => ({ followCreatorAction: mocks.followCreatorAction }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SourcesStep } from "./sources-step";

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

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  mocks.addChannelAction.mockReset();
  mocks.followCreatorAction.mockReset();
});

afterEach(() => {
  cleanup();
});

test("following a curated creator alone lets Continue proceed with its channel id", async () => {
  mocks.followCreatorAction.mockImplementation((handle: string) =>
    Promise.resolve({ ok: true, channelId: `ch-${handle}`, syncQueued: true, alreadyTracked: false })
  );
  const onContinue = vi.fn();

  render(
    <SourcesStep
      niche="fitness"
      seeds={[seed()]}
      canVerifyHandles
      onBack={() => {}}
      onContinue={onContinue}
    />
  );

  const continueBtn = screen.getByRole("button", { name: /continue/i }) as HTMLButtonElement;
  // No manual handle typed, nothing followed yet: Continue is locked.
  expect(continueBtn.disabled).toBe(true);

  await act(async () => {
    fireEvent.click(screen.getByTestId("seed-picker-checkbox-lift.laura"));
    fireEvent.click(screen.getByTestId("seed-picker-follow-selected"));
    await flush();
  });

  expect(continueBtn.disabled).toBe(false);
  await act(async () => {
    fireEvent.click(continueBtn);
    await flush();
  });

  // No manual handle, so addChannelAction is never called; the followed seed's channel id
  // is what Continue commits.
  expect(mocks.addChannelAction).not.toHaveBeenCalled();
  expect(onContinue).toHaveBeenCalledWith(["ch-lift.laura"]);
});

test("seed-followed and manually added channel ids are merged on Continue", async () => {
  mocks.followCreatorAction.mockImplementation((handle: string) =>
    Promise.resolve({ ok: true, channelId: `ch-${handle}`, syncQueued: true, alreadyTracked: false })
  );
  mocks.addChannelAction.mockResolvedValue({ ok: true, channelId: "ch-manual" });
  const onContinue = vi.fn();

  render(
    <SourcesStep
      niche="fitness"
      seeds={[seed()]}
      canVerifyHandles
      onBack={() => {}}
      onContinue={onContinue}
    />
  );

  await act(async () => {
    fireEvent.click(screen.getByTestId("seed-picker-checkbox-lift.laura"));
    fireEvent.click(screen.getByTestId("seed-picker-follow-selected"));
    await flush();
  });

  const input = screen.getByLabelText("Instagram handles");
  fireEvent.change(input, { target: { value: "@rival.rick" } });
  fireEvent.keyDown(input, { key: "Enter" });

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await flush();
  });

  expect(mocks.addChannelAction).toHaveBeenCalledWith("@rival.rick");
  expect(onContinue).toHaveBeenCalledWith(["ch-lift.laura", "ch-manual"]);
});

test("ONB-3: a malformed handle is rejected inline and never enters the pending list, so a well-formed handle beside it still Continues cleanly", async () => {
  mocks.addChannelAction.mockResolvedValue({ ok: true, channelId: "ch-good" });
  const onContinue = vi.fn();

  render(
    <SourcesStep niche="fitness" seeds={[]} canVerifyHandles onBack={() => {}} onContinue={onContinue} />
  );

  const input = screen.getByLabelText("Instagram handles");
  fireEvent.change(input, { target: { value: "@good.handle, bad$handle" } });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

  // Well-formed handle queued (normalized), malformed one rejected inline before it ever
  // reaches the pending list.
  expect(screen.getByText("@good.handle")).not.toBeNull();
  expect(screen.queryByText("bad$handle")).toBeNull();
  expect(screen.getByText(/invalid instagram handle/i)).not.toBeNull();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await flush();
  });

  // Continue only ever sees the well-formed handle: no partial write is attempted for the
  // one that was rejected up front.
  expect(mocks.addChannelAction).toHaveBeenCalledTimes(1);
  expect(mocks.addChannelAction).toHaveBeenCalledWith("@good.handle");
  expect(onContinue).toHaveBeenCalledWith(["ch-good"]);
});

test("ONB-3: a lone malformed handle never enables Continue and is never sent to addChannelAction", () => {
  render(<SourcesStep niche="fitness" seeds={[]} canVerifyHandles onBack={() => {}} onContinue={() => {}} />);

  const input = screen.getByLabelText("Instagram handles");
  fireEvent.change(input, { target: { value: "bad$handle" } });
  fireEvent.keyDown(input, { key: "Enter" });

  expect(screen.getByText(/invalid instagram handle/i)).not.toBeNull();
  expect((screen.getByRole("button", { name: /continue/i }) as HTMLButtonElement).disabled).toBe(true);
});

describe("no seeds", () => {
  test("without seeds the picker is absent and a manual handle is still required", () => {
    render(
      <SourcesStep niche="fitness" seeds={[]} canVerifyHandles onBack={() => {}} onContinue={() => {}} />
    );
    expect(screen.queryByTestId("first-run-seed-picker")).toBeNull();
    expect((screen.getByRole("button", { name: /continue/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
