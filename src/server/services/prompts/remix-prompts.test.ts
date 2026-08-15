import { describe, expect, it } from "vitest";
import { buildHookUser, buildOutlineUser, buildScriptUser } from "./remix-prompts";

const BASE_OUTLINE = { beats: [{ label: "Hook", content: "open strong", targetSec: 3 }] };

describe("buildHookUser", () => {
  it("includes whyItWorked and openingLine when present, omits them when absent (spec part 1)", () => {
    const withFields = buildHookUser({
      topic: "t", niche: "n", pattern: "curiosity-gap",
      whyItWorked: "the retention mechanism", openingLine: "wait, do this before you post",
    });
    expect(withFields).toContain("Why the source worked: the retention mechanism");
    expect(withFields).toContain("Source opening line: wait, do this before you post");

    const withoutFields = buildHookUser({ topic: "t", niche: "n", pattern: "curiosity-gap" });
    expect(withoutFields).not.toContain("Why the source worked");
    expect(withoutFields).not.toContain("Source opening line");
  });

  it("threads steer into the prompt when present (spec part 6)", () => {
    const withSteer = buildHookUser({ topic: "t", niche: "n", pattern: "curiosity-gap", steer: "make it punchier" });
    expect(withSteer).toContain("Steer: make it punchier");

    const withoutSteer = buildHookUser({ topic: "t", niche: "n", pattern: "curiosity-gap" });
    expect(withoutSteer).not.toContain("Steer:");
  });
});

describe("buildOutlineUser", () => {
  it("includes whyItWorked when present, omits it when absent (spec part 1)", () => {
    const withField = buildOutlineUser({
      topic: "t", niche: "n", hook: "h", targetLengthSec: 30, structure: "s", whyItWorked: "strong hook",
    });
    expect(withField).toContain("Why the source worked: strong hook");

    const withoutField = buildOutlineUser({ topic: "t", niche: "n", hook: "h", targetLengthSec: 30, structure: "s" });
    expect(withoutField).not.toContain("Why the source worked");
  });
});

describe("buildScriptUser", () => {
  it("includes sourceBeats and whyItWorked in a 'Source that worked' block when present, omits it when absent", () => {
    const withSource = buildScriptUser({
      topic: "t", niche: "n", hook: "h", outline: BASE_OUTLINE, targetLengthSec: 30,
      whyItWorked: "strong retention hook",
      sourceBeats: [{ label: "Hook", startSec: 0, endSec: 3, note: "cold open with a question", transcript: "wait, do this first" }],
    });
    expect(withSource).toContain("Source that worked:");
    expect(withSource).toContain("Why it worked: strong retention hook");
    expect(withSource).toContain("Hook (0s to 3s): cold open with a question");
    expect(withSource).toContain("said: wait, do this first");
    // Q3 framing: adapt, do not copy.
    expect(withSource).toContain("do not copy its words");

    const withoutSource = buildScriptUser({ topic: "t", niche: "n", hook: "h", outline: BASE_OUTLINE, targetLengthSec: 30 });
    expect(withoutSource).not.toContain("Source that worked");
  });

  it("renders a beat without a captured transcript as its note alone, no placeholder (anti-fabrication)", () => {
    const user = buildScriptUser({
      topic: "t", niche: "n", hook: "h", outline: BASE_OUTLINE, targetLengthSec: 30,
      sourceBeats: [{ label: "Build", startSec: 3, endSec: 20, note: "explains the mechanism" }],
    });
    expect(user).toContain("Build (3s to 20s): explains the mechanism");
    expect(user).not.toContain("said:");
  });
});
