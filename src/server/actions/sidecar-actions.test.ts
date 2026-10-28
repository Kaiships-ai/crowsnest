import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// No real process spawns and no real health probe fires here: `control.ts`'s own
// spawn/pid-file behavior is covered by control.test.ts, and this file is only about
// startSidecarAction's decision of when to report ok: true.
vi.mock("@/server/sidecar/control", () => ({
  startSidecar: vi.fn(),
  stopSidecar: vi.fn(),
  sidecarPidAlive: vi.fn(() => true),
}));
vi.mock("@/server/actions/ig-actions", () => ({ getIgStatusAction: vi.fn() }));
vi.mock("@/server/services/connector-status", () => ({ recordSwitch: vi.fn(), sampleConnector: vi.fn() }));
vi.mock("@/server/actions/secrets-actions", () => ({ setConnectorSecret: vi.fn() }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

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

  test("a cold start that answers after 20 s keeps waiting and reports ok", async () => {
    const { getIgStatusAction } = await import("@/server/actions/ig-actions");
    const startedAt = Date.now();
    vi.mocked(getIgStatusAction).mockImplementation(async () => (Date.now() - startedAt >= 20_000 ? healthy() : down()));
    const { startSidecarAction } = await import("./sidecar-actions");

    const result = startSidecarAction();
    await vi.advanceTimersByTimeAsync(20_500);

    expect(await result).toEqual({ ok: true });
  });

  test("a process that exits at 3 s fails then, without waiting out the bound", async () => {
    const { getIgStatusAction } = await import("@/server/actions/ig-actions");
    const { sidecarPidAlive } = await import("@/server/sidecar/control");
    const startedAt = Date.now();
    vi.mocked(getIgStatusAction).mockResolvedValue(down());
    vi.mocked(sidecarPidAlive).mockImplementation(() => Date.now() - startedAt < 3_000);
    const { startSidecarAction } = await import("./sidecar-actions");

    const result = startSidecarAction();
    await vi.advanceTimersByTimeAsync(3_500);

    expect(await result).toEqual({
      ok: false,
      error: "sidecar did not start (check that uv is installed and Instagram credentials are set in Settings)",
    });
  });

  test("a live process that never answers fails at 60 s and is stopped", async () => {
    const { getIgStatusAction } = await import("@/server/actions/ig-actions");
    const { sidecarPidAlive, stopSidecar } = await import("@/server/sidecar/control");
    vi.mocked(getIgStatusAction).mockResolvedValue(down());
    vi.mocked(sidecarPidAlive).mockReturnValue(true);
    const { startSidecarAction } = await import("./sidecar-actions");

    let settled = false;
    const result = startSidecarAction().finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);

    expect(await result).toEqual({ ok: false, error: "sidecar did not answer within 60 s" });
    expect(stopSidecar).toHaveBeenCalledTimes(1);
  });

  test("surfaces a synchronous startSidecar throw without polling", async () => {
    const { getIgStatusAction } = await import("@/server/actions/ig-actions");
    const { startSidecar } = await import("@/server/sidecar/control");
    vi.mocked(getIgStatusAction).mockResolvedValue(down());
    vi.mocked(startSidecar).mockImplementation(() => {
      throw new Error("spawn uv ENOENT");
    });
    const { startSidecarAction } = await import("./sidecar-actions");

    const result = await startSidecarAction();

    expect(result).toEqual({ ok: false, error: "spawn uv ENOENT" });
  });
});

describe("saveSidecarSessionAction", () => {
  test("a stored and adopted id is a saved session even when the sample after it hits an Instagram limit", async () => {
    const { setConnectorSecret } = await import("@/server/actions/secrets-actions");
    const { sampleConnector } = await import("@/server/services/connector-status");
    vi.mocked(setConnectorSecret).mockResolvedValue({ ok: true });
    vi.mocked(sampleConnector).mockResolvedValue({
      ok: false,
      message: "Instagram is limiting requests.",
      retryAfter: "2026-10-28T21:40:00.000Z",
    });
    const { saveSidecarSessionAction } = await import("./sidecar-actions");

    expect(await saveSidecarSessionAction("123%3Aabc")).toEqual({ ok: true });
    expect(vi.mocked(setConnectorSecret).mock.calls).toEqual([["ig-sidecar", "IG_SESSIONID", "123%3Aabc"]]);
    expect(vi.mocked(sampleConnector).mock.calls).toEqual([["ig-sidecar"]]);
  });

  test("an id the sidecar refuses is a failed save, and no sample runs", async () => {
    const { setConnectorSecret } = await import("@/server/actions/secrets-actions");
    const { sampleConnector } = await import("@/server/services/connector-status");
    vi.mocked(setConnectorSecret).mockResolvedValue({ ok: false, error: "Saved, but Instagram asks for challenge required." });
    const { saveSidecarSessionAction } = await import("./sidecar-actions");

    expect(await saveSidecarSessionAction("123%3Aabc")).toEqual({ ok: false, error: "Saved, but Instagram asks for challenge required." });
    expect(sampleConnector).not.toHaveBeenCalled();
  });
});
