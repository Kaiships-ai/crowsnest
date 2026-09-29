import { beforeEach, describe, expect, test, vi } from "vitest";

const graphClient = vi.hoisted(() => ({ checkToken: vi.fn() }));
vi.mock("./client", () => ({ graphClient }));

const { cachedTokenStatus, invalidateTokenStatus, rememberTokenStatus } = await import("./token-status");

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

  test.each(["rate_limited", "network", "unknown"])("a transient %s check is cached for 30 seconds, not five minutes", async (state) => {
    graphClient.checkToken.mockResolvedValue({ ...OK, state, username: null });
    await cachedTokenStatus(0);
    await cachedTokenStatus(29_000);
    expect(graphClient.checkToken).toHaveBeenCalledTimes(1);
    await cachedTokenStatus(30_000);
    expect(graphClient.checkToken).toHaveBeenCalledTimes(2);
  });

  test.each(["auth_failed", "permission_denied"])("a definitive %s state keeps the full TTL", async (state) => {
    graphClient.checkToken.mockResolvedValue({ ...OK, state, username: null });
    await cachedTokenStatus(0);
    await cachedTokenStatus(4 * 60_000);
    expect(graphClient.checkToken).toHaveBeenCalledTimes(1);
  });

  test("a remembered status (a measurement's outcome) is served without a live check", async () => {
    rememberTokenStatus({ ...OK, state: "permission_denied", username: null, message: "no insights" }, 0);
    expect((await cachedTokenStatus(60_000)).state).toBe("permission_denied");
    expect(graphClient.checkToken).not.toHaveBeenCalled();
  });
});

describe("one cache per process", () => {
  test("a second copy of the module (tsx scheduler vs the Next bundle) sees the same cache", async () => {
    rememberTokenStatus({ ...OK, state: "permission_denied", username: null, message: "no insights" }, 0);
    vi.resetModules();
    const other = await import("./token-status");
    expect((await other.cachedTokenStatus(60_000)).state).toBe("permission_denied");
    expect(graphClient.checkToken).not.toHaveBeenCalled();
  });
});
