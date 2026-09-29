import { beforeEach, describe, expect, test, vi } from "vitest";

const graphClient = vi.hoisted(() => ({ checkToken: vi.fn() }));
vi.mock("./client", () => ({ graphClient }));

const { cachedTokenStatus, invalidateTokenStatus } = await import("./token-status");

const OK = { configured: true, username: "me", state: "ok", message: null, checkedAt: "2026-09-30T00:00:00.000Z" };

beforeEach(() => {
  invalidateTokenStatus();
  graphClient.checkToken.mockReset().mockResolvedValue(OK);
});

describe("cachedTokenStatus", () => {
  test("repeat renders inside five minutes reuse one live check", async () => {
    const t0 = 1_000_000;
    expect(await cachedTokenStatus(t0)).toEqual(OK);
    await cachedTokenStatus(t0 + 60_000);
    await cachedTokenStatus(t0 + 4 * 60_000);
    expect(graphClient.checkToken).toHaveBeenCalledTimes(1);
    await cachedTokenStatus(t0 + 5 * 60_000);
    expect(graphClient.checkToken).toHaveBeenCalledTimes(2);
  });

  test("invalidating (token saved, or a measurement hit an auth failure) forces a live check", async () => {
    await cachedTokenStatus(1);
    invalidateTokenStatus();
    await cachedTokenStatus(2);
    expect(graphClient.checkToken).toHaveBeenCalledTimes(2);
  });
});
