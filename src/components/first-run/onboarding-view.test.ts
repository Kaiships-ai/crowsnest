import { describe, expect, test } from "vitest";
import { ONBOARDING_STEP_COUNT, ONBOARDING_STEPS, stepIndex, stepNavState } from "./onboarding-view";

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
