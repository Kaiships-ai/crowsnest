/**
 * @vitest-environment jsdom
 *
 * BEH-01 / BUG-1: a pasted profile URL in the "By handle" field must be rejected inline
 * as a typo, not silently normalized and sent to the add-channel action. Same jsdom +
 * mocked-server-action pattern as kanban-board.test.tsx.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addChannelAction: vi.fn(),
  importReelAction: vi.fn(),
}));

vi.mock("@/server/actions/sync-actions", () => mocks);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { AddChannelDialog } from "./add-channel-dialog";

beforeEach(() => {
  mocks.addChannelAction.mockReset();
  mocks.importReelAction.mockReset();
});

afterEach(cleanup);

test("rejects a pasted profile URL as a typo without calling the add-channel action", async () => {
  render(<AddChannelDialog open onOpenChange={() => {}} initialTab="handle" />);

  const input = screen.getByTestId("add-channel-handle-input");
  fireEvent.change(input, { target: { value: "https://www.instagram.com/creator/" } });
  await act(async () => {
    fireEvent.click(screen.getByTestId("add-channel-submit-handle"));
  });

  expect(mocks.addChannelAction).not.toHaveBeenCalled();
  expect(screen.getByText(/looks like a URL/i)).toBeTruthy();
});

test("submits a bare handle normally", async () => {
  mocks.addChannelAction.mockResolvedValue({ ok: true });
  render(<AddChannelDialog open onOpenChange={() => {}} initialTab="handle" />);

  const input = screen.getByTestId("add-channel-handle-input");
  fireEvent.change(input, { target: { value: "creator" } });
  await act(async () => {
    fireEvent.click(screen.getByTestId("add-channel-submit-handle"));
  });

  expect(mocks.addChannelAction).toHaveBeenCalledWith("creator", { requireProfile: true });
});
