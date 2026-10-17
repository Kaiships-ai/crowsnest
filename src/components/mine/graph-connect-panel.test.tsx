/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const actions = vi.hoisted(() => ({
  checkGraphTokenAction: vi.fn(async () => ({ ok: true as const, status: { configured: true, username: "me", state: "ok" as const, message: null, checkedAt: "2026-10-17T00:00:00.000Z" } })),
  measureOwnChannelAction: vi.fn(),
}));
vi.mock("@/server/actions/graph-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { GraphConnectPanel } = await import("./graph-connect-panel");
afterEach(cleanup);

test("with nothing cached the card says chưa kiểm tra, and only Check makes the live call", async () => {
  render(<GraphConnectPanel ownHandle={null} initialStatus={null} everMeasured />);
  expect(screen.getByTestId("mine-connect-checked").textContent).toBe("chưa kiểm tra");
  expect(actions.checkGraphTokenAction).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByTestId("mine-connect-check")));
  expect(actions.checkGraphTokenAction).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Connected")).toBeTruthy();
});
