import { describe, expect, test } from "vitest";
import { canVerifyHandles, ONBOARDING_STEP_COUNT, ONBOARDING_STEPS, stepIndex, stepNavState } from "./onboarding-view";

describe("ONBOARDING_STEPS", () => {
  test("numbering matches the ruling: 01 FOCUS, 02 INSTAGRAM, 03 CHANNELS, 04 FIRST SYNC", () => {
    expect(ONBOARDING_STEPS.map((s) => `${s.n} ${s.label}`)).toEqual([
      "01 FOCUS",
      "02 INSTAGRAM",
      "03 CHANNELS",
      "04 FIRST SYNC",
    ]);
  });

  test("the welcome screen's step count reads off the list, not a hardcoded word", () => {
    expect(ONBOARDING_STEP_COUNT).toBe(4);
  });
});

describe("stepIndex", () => {
  test("orders welcome before every numbered step", () => {
    expect(stepIndex("welcome")).toBeLessThan(stepIndex("focus"));
    expect(stepIndex("focus")).toBeLessThan(stepIndex("connect"));
    expect(stepIndex("connect")).toBeLessThan(stepIndex("sources"));
    expect(stepIndex("sources")).toBeLessThan(stepIndex("sync"));
  });
});

describe("stepNavState", () => {
  test("a step behind the current one is done", () => {
    expect(stepNavState("sources", "focus")).toBe("done");
  });

  test("the current step is current", () => {
    expect(stepNavState("sources", "sources")).toBe("current");
  });

  test("a step ahead of the current one is locked", () => {
    expect(stepNavState("focus", "sync")).toBe("locked");
  });
});

describe("canVerifyHandles", () => {
  const okLoggedIn = {
    ok: true as const,
    status: {
      loggedIn: true,
      credentialsConfigured: true,
      username: "kaiships.ai",
      instagrapiVersion: "2.0.0",
      sessionLoaded: true,
      cooldownUntil: null,
    },
  };

  test("true when the sidecar reports a live, logged-in session", () => {
    expect(canVerifyHandles(okLoggedIn)).toBe(true);
  });

  test("false when the sidecar is reachable but nobody is logged in — /profile still needs a session", () => {
    expect(canVerifyHandles({ ...okLoggedIn, status: { ...okLoggedIn.status, loggedIn: false } })).toBe(false);
  });

  test("false when the status check itself failed (service down, or any other error)", () => {
    expect(
      canVerifyHandles({
        ok: false,
        error: "Nothing answered at http://localhost:20128",
        code: "IG_SERVICE_DOWN",
        retryable: true,
        needsUserAction: true,
      })
    ).toBe(false);
  });
});
