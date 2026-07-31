import { describe, expect, test, vi } from "vitest";
import {
  bothHealthy,
  classifyLlmStatus,
  classifySidecarStatus,
  PING_TIMED_OUT,
  withTimeout,
  type IgStatusResult,
} from "./dependency-status";

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

describe("classifyLlmStatus", () => {
  test("no key configured reads as not_configured with no ping needed", () => {
    const result = classifyLlmStatus({ hasKey: false, proxyUrl: null, routedThroughProxy: false, ping: PING_TIMED_OUT });
    expect(result.state).toBe("not_configured");
    expect(result.reachable).toBeNull();
  });

  test("a successful ping in native mode reads as up and reachable", () => {
    const result = classifyLlmStatus({
      hasKey: true,
      proxyUrl: null,
      routedThroughProxy: false,
      ping: { ok: true },
    });
    expect(result.state).toBe("up");
    expect(result.reachable).toBe(true);
  });

  test("a real live case: proxy answers, model dead (410) — down, but reachable stays true, not a false green", () => {
    const result = classifyLlmStatus({
      hasKey: true,
      proxyUrl: "http://localhost:20128",
      routedThroughProxy: true,
      ping: { ok: false, error: "Claude API error: 410 (not_found_error)" },
    });
    expect(result.state).toBe("down");
    expect(result.reachable).toBe(true);
    expect(result.detail).toBe("Claude API error: 410 (not_found_error)");
  });

  test("a real live case: proxy answers, token expired (401) — down, reachable true", () => {
    const result = classifyLlmStatus({
      hasKey: true,
      proxyUrl: "http://localhost:20128",
      routedThroughProxy: true,
      ping: { ok: false, error: "API key invalid or revoked — check Settings" },
    });
    expect(result.state).toBe("down");
    expect(result.reachable).toBe(true);
  });

  test("nothing answers at all (APIConnectionError's mapped message) — down, and reachable is false", () => {
    const result = classifyLlmStatus({
      hasKey: true,
      proxyUrl: "http://localhost:20128",
      routedThroughProxy: true,
      ping: { ok: false, error: "Network error reaching Claude" },
    });
    expect(result.state).toBe("down");
    expect(result.reachable).toBe(false);
  });

  test("proxy mode: a passing ping is reachable_unverified, never up — count_tokens doesn't prove generation works", () => {
    const result = classifyLlmStatus({
      hasKey: true,
      proxyUrl: "http://localhost:20128",
      routedThroughProxy: true,
      ping: { ok: true },
    });
    expect(result.state).toBe("reachable_unverified");
    expect(result.reachable).toBe(true);
  });

  test("native mode: a passing ping is up — the real API's count_tokens validates key and model", () => {
    const result = classifyLlmStatus({
      hasKey: true,
      proxyUrl: null,
      routedThroughProxy: false,
      ping: { ok: true },
    });
    expect(result.state).toBe("up");
  });

  test("a timed-out check reads as unknown, never coerced into down", () => {
    const result = classifyLlmStatus({ hasKey: true, proxyUrl: null, routedThroughProxy: false, ping: PING_TIMED_OUT });
    expect(result.state).toBe("unknown");
    expect(result.reachable).toBeNull();
  });

  test("proxyUrl and routedThroughProxy pass through unchanged on every branch", () => {
    for (const ping of [PING_TIMED_OUT, { ok: true } as const, { ok: false, error: "x" } as const]) {
      const result = classifyLlmStatus({ hasKey: true, proxyUrl: "http://x", routedThroughProxy: true, ping });
      expect(result.proxyUrl).toBe("http://x");
      expect(result.routedThroughProxy).toBe(true);
    }
  });
});

describe("bothHealthy", () => {
  test("true only when both are up", () => {
    const up = classifySidecarStatus(igOk());
    const llmUp = classifyLlmStatus({ hasKey: true, proxyUrl: null, routedThroughProxy: false, ping: { ok: true } });
    expect(bothHealthy(up, llmUp)).toBe(true);
  });

  test("false when the sidecar is down even if the LLM is up", () => {
    const down = classifySidecarStatus(igFail("IG_SERVICE_DOWN"));
    const llmUp = classifyLlmStatus({ hasKey: true, proxyUrl: null, routedThroughProxy: false, ping: { ok: true } });
    expect(bothHealthy(down, llmUp)).toBe(false);
  });

  test("false when the LLM is down even if the sidecar is up", () => {
    const up = classifySidecarStatus(igOk());
    const llmDown = classifyLlmStatus({ hasKey: true, proxyUrl: null, routedThroughProxy: false, ping: { ok: false, error: "x" } });
    expect(bothHealthy(up, llmDown)).toBe(false);
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
