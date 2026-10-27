import { afterEach, describe, expect, test, vi } from "vitest";

// No real process spawns and no real health probe fires here: `control.ts`'s own
// spawn/pid-file behavior is covered by control.test.ts, and this file is only about
// startSidecarAction's decision of when to report ok: true.
vi.mock("@/server/sidecar/control", () => ({
  startSidecar: vi.fn(),
  stopSidecar: vi.fn(),
  sidecarPidAlive: vi.fn(() => false),
}));
vi.mock("@/server/actions/ig-actions", () => ({ getIgStatusAction: vi.fn() }));
vi.mock("@/server/services/connector-status", () => ({ recordSwitch: vi.fn(), sampleConnector: vi.fn() }));

afterEach(() => vi.clearAllMocks());

type StatusResult = Awaited<ReturnType<typeof import("@/server/actions/ig-actions").getIgStatusAction>>;

function healthy(): StatusResult {
  return {
    ok: true,
    status: {
      loggedIn: true,
      credentialsConfigured: true,
      username: "burner",
      instagrapiVersion: "2.0.0",
      sessionLoaded: true,
      cooldownUntil: null,
    },
  };
}

function down(): StatusResult {
  return { ok: false, error: "Instagram service is not reachable.", code: "IG_SERVICE_DOWN", retryable: true, needsUserAction: false };
}

describe("startSidecarAction", () => {
  test("is a no-op success when the sidecar already answers healthy", async () => {
    const { getIgStatusAction } = await import("@/server/actions/ig-actions");
    const { startSidecar } = await import("@/server/sidecar/control");
    vi.mocked(getIgStatusAction).mockResolvedValue(healthy());
    const { startSidecarAction } = await import("./sidecar-actions");

    const result = await startSidecarAction();

    expect(result).toEqual({ ok: true });
    expect(startSidecar).not.toHaveBeenCalled();
  });

  test("reports ok once health answers healthy after a couple of polls", async () => {
    const { getIgStatusAction } = await import("@/server/actions/ig-actions");
    vi.mocked(getIgStatusAction)
      .mockResolvedValueOnce(down()) // initial no-op-success check
      .mockResolvedValueOnce(down()) // poll 1
      .mockResolvedValueOnce(down()) // poll 2
      .mockResolvedValueOnce(healthy()); // poll 3
    const { startSidecarAction } = await import("./sidecar-actions");

    // Short interval/timeout: the poll window is a parameter precisely so tests never
    // wait out the real ~5s default.
    const result = await startSidecarAction(5, 200);

    expect(result).toEqual({ ok: true });
  });

  test("reports a clear failure when health never comes up healthy within the window", async () => {
    const { getIgStatusAction } = await import("@/server/actions/ig-actions");
    vi.mocked(getIgStatusAction).mockResolvedValue(down());
    const { startSidecarAction } = await import("./sidecar-actions");

    const result = await startSidecarAction(5, 30);

    expect(result).toEqual({
      ok: false,
      error: "sidecar did not start (check that uv is installed and Instagram credentials are set in Settings)",
    });
  });

  test("surfaces a synchronous startSidecar throw without polling", async () => {
    const { getIgStatusAction } = await import("@/server/actions/ig-actions");
    const { startSidecar } = await import("@/server/sidecar/control");
    vi.mocked(getIgStatusAction).mockResolvedValue(down());
    vi.mocked(startSidecar).mockImplementation(() => {
      throw new Error("spawn uv ENOENT");
    });
    const { startSidecarAction } = await import("./sidecar-actions");

    const result = await startSidecarAction(5, 30);

    expect(result).toEqual({ ok: false, error: "spawn uv ENOENT" });
  });
});
