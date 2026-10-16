import { describe, expect, test, vi } from "vitest";
import {
  bothHealthy,
  classifyGraphStatus,
  classifySidecarStatus,
  PING_TIMED_OUT,
  withTimeout,
  type IgStatusResult,
} from "./dependency-status";
import type { GraphTokenStatus } from "@/server/graph/client";

function igOk(overrides: Partial<Extract<IgStatusResult, { ok: true }>["status"]> = {}): IgStatusResult {
  return {
    ok: true,
    status: {
      loggedIn: true,
      credentialsConfigured: true,
      username: "burner",
      instagrapiVersion: "1.0",
      sessionLoaded: true,
      cooldownUntil: null,
      ...overrides,
    },
  };
}

function igFail(code: string, error = "failed"): IgStatusResult {
  return { ok: false, error, code, retryable: false, needsUserAction: false };
}

describe("classifySidecarStatus", () => {
  test("ok result reads as up with no detail", () => {
    expect(classifySidecarStatus(igOk())).toEqual({ state: "up", detail: null });
  });

  test("IG_SERVICE_DOWN reads as down, carrying the action's own message", () => {
    expect(classifySidecarStatus(igFail("IG_SERVICE_DOWN", "The Instagram service isn't running."))).toEqual({
      state: "down",
      detail: "The Instagram service isn't running.",
    });
  });

  test("a logged-out-but-reachable sidecar is up, not down — process health and login are different facts", () => {
    expect(classifySidecarStatus(igOk({ loggedIn: false }))).toEqual({ state: "up", detail: null });
  });

  test("a non-service-down failure (e.g. drift) reads as error, not down — starting the process wouldn't fix it", () => {
    expect(classifySidecarStatus(igFail("IG_DRIFT", "health response shape changed"))).toEqual({
      state: "error",
      detail: "health response shape changed",
    });
  });
});

function token(state: GraphTokenStatus["state"], message: string | null = null): GraphTokenStatus {
  return { configured: state !== "not_configured", username: null, state, message, checkedAt: "2026-01-01T00:00:00.000Z" };
}

describe("classifyGraphStatus", () => {
  test("ok reads as up", () => {
    expect(classifyGraphStatus(token("ok"))).toEqual({ state: "up", detail: null });
  });

  test("auth and network failures read as down with the check's own message", () => {
    expect(classifyGraphStatus(token("auth_failed", "Token expired"))).toEqual({ state: "down", detail: "Token expired" });
    expect(classifyGraphStatus(token("network", "offline")).state).toBe("down");
  });

  test("no token, a rate limit, or a timeout is a warning, not down", () => {
    expect(classifyGraphStatus(token("not_configured")).state).toBe("not_configured");
    expect(classifyGraphStatus(token("rate_limited")).state).toBe("unknown");
    expect(classifyGraphStatus(PING_TIMED_OUT).state).toBe("unknown");
  });
});

describe("bothHealthy", () => {
  test("true only when both are up", () => {
    expect(bothHealthy(classifySidecarStatus(igOk()), classifyGraphStatus(token("ok")))).toBe(true);
    expect(bothHealthy(classifySidecarStatus(igFail("IG_SERVICE_DOWN")), classifyGraphStatus(token("ok")))).toBe(false);
    expect(bothHealthy(classifySidecarStatus(igOk()), classifyGraphStatus(token("auth_failed")))).toBe(false);
  });
});

describe("withTimeout", () => {
  test("resolves with the promise's value when it settles before the timer", async () => {
    const result = await withTimeout(Promise.resolve("ok" as const), 1000);
    expect(result).toBe("ok");
  });

  test("resolves to PING_TIMED_OUT when the timer fires first", async () => {
    vi.useFakeTimers();
    const neverSettles = new Promise(() => {});
    const promise = withTimeout(neverSettles, 50);
    vi.advanceTimersByTime(50);
    await expect(promise).resolves.toBe(PING_TIMED_OUT);
    vi.useRealTimers();
  });

  test("a rejected promise also resolves to PING_TIMED_OUT rather than throwing", async () => {
    const result = await withTimeout(Promise.reject(new Error("boom")), 1000);
    expect(result).toBe(PING_TIMED_OUT);
  });
});
