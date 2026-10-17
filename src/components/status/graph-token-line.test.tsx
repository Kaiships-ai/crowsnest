/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const graphClient = vi.hoisted(() => ({ checkToken: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/server/graph/client", () => ({ graphClient }));

const { invalidateTokenStatus, rememberTokenStatus } = await import("@/server/graph/token-status");
const { GraphTokenLine } = await import("./graph-token-line");

const at = "2026-10-17T00:00:00.000Z";
beforeEach(invalidateTokenStatus);
afterEach(cleanup);

describe("GraphTokenLine", () => {
  test("with nothing cached it renders nothing and never calls Graph", () => {
    expect(GraphTokenLine({})).toBeNull();
    expect(graphClient.checkToken).not.toHaveBeenCalled();
  });

  test("a refused token shows one line linking to the Instagram card", () => {
    rememberTokenStatus({ configured: true, username: null, state: "auth_failed", message: "bad", checkedAt: at });
    render(<GraphTokenLine />);
    expect(screen.getByTestId("graph-token-line").getAttribute("href")).toBe("/settings#graph-api");
  });

  test("an ok token after a refusal clears the line", () => {
    rememberTokenStatus({ configured: true, username: null, state: "auth_failed", message: "bad", checkedAt: at });
    rememberTokenStatus({ configured: true, username: "me", state: "ok", message: null, checkedAt: at });
    expect(GraphTokenLine({})).toBeNull();
  });
});
