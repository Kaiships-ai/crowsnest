import { describe, expect, test } from "vitest";
import { buildLayoutPrompt, parseLayoutResult, LayoutParseError, type LayoutBeat } from "./frame-pass-prompt";
import type { SampledFrame } from "./watch-frames";

const FRAMES: SampledFrame[] = [
  { path: "/tmp/f/frame_0001.jpg", timestampSeconds: 0, reason: "first-frame" },
  { path: "/tmp/f/frame_0002.jpg", timestampSeconds: 3, reason: "scene-change" },
];

const BEATS: LayoutBeat[] = [
  { label: "Hook", startSec: 0, endSec: 3 },
  { label: "Payoff", startSec: 3, endSec: 9 },
];

/** A full beat row with every field readable, so a test only has to override what it cares about. */
function beatRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    startSec: 0,
    endSec: 3,
    label: "Hook",
    onScreenText: { value: "Claude", fromFramesSec: [3, 0, 3] },
    animation: { value: "slow push in", fromFramesSec: [0] },
    demoCursor: { value: null, fromFramesSec: [] },
    toolDemo: { value: null, fromFramesSec: [] },
    textPosition: { value: null, fromFramesSec: [] },
    voicePace: { value: "rapid", fromFramesSec: [0, 3] },
    ...over,
  };
}

describe("buildLayoutPrompt", () => {
  test("names every frame path with its timestamp", () => {
    const p = buildLayoutPrompt(FRAMES, BEATS);
    expect(p).toContain("/tmp/f/frame_0001.jpg");
    expect(p).toContain("/tmp/f/frame_0002.jpg");
    expect(p).toContain("t=0s");
    expect(p).toContain("t=3s");
  });

  test("names every beat with its window, so the model keys its rows to the analysis and not to boundaries it invented", () => {
    const p = buildLayoutPrompt(FRAMES, BEATS);
    expect(p).toContain('"Hook" covering t=0s to t=3s');
    expect(p).toContain('"Payoff" covering t=3s to t=9s');
  });

  test("asks for a short citation, which is what stops the output truncating", () => {
    expect(buildLayoutPrompt(FRAMES, BEATS)).toContain("1 to 2");
  });

  test("asks for all six readings", () => {
    const p = buildLayoutPrompt(FRAMES, BEATS);
    for (const key of ["onScreenText", "animation", "demoCursor", "toolDemo", "textPosition", "voicePace"]) {
      expect(p).toContain(key);
    }
  });

  test("the example skeleton it prints is one row per beat, so the model has the array shape in front of it", () => {
    const p = buildLayoutPrompt(FRAMES, BEATS);
    expect(p).toContain('[{"startSec":0,"endSec":3,"label":"Hook"');
    expect(p).toContain('{"startSec":3,"endSec":9,"label":"Payoff"');
  });
});

describe("parseLayoutResult", () => {
  const good = JSON.stringify([beatRow(), beatRow({ startSec: 3, endSec: 9, label: "Payoff" })]);

  test("parses a bare JSON array", () => {
    expect(parseLayoutResult(good)[0].onScreenText.value).toBe("Claude");
  });

  test("keeps one row per beat, in order", () => {
    const out = parseLayoutResult(good);
    expect(out).toHaveLength(2);
    expect(out.map((b) => b.label)).toEqual(["Hook", "Payoff"]);
    expect(out[1].startSec).toBe(3);
  });

  test("parses JSON wrapped in a markdown fence", () => {
    expect(parseLayoutResult("```json\n" + good + "\n```")[0].animation.value).toBe("slow push in");
  });

  test("dedupes and sorts fromFramesSec on every beat row", () => {
    expect(parseLayoutResult(good)[0].onScreenText.fromFramesSec).toEqual([0, 3]);
    expect(parseLayoutResult(good)[1].onScreenText.fromFramesSec).toEqual([0, 3]);
  });

  test("keeps a genuine null field as null", () => {
    const out = parseLayoutResult(good);
    expect(out[0].textPosition.value).toBeNull();
    expect(out[0].textPosition.fromFramesSec).toEqual([]);
  });

  test("throws on JSON with no closing bracket at all", () => {
    expect(() => parseLayoutResult('[{"startSec":0,"endSec":3,"label":"Hook"')).toThrow(LayoutParseError);
  });

  test("throws on a realistically truncated payload where the first row closed but the array did not", () => {
    const truncated = `[${JSON.stringify(beatRow())},`;
    expect(() => parseLayoutResult(truncated)).toThrow(LayoutParseError);
  });

  test("throws when the shape is not a VideoLayout", () => {
    expect(() => parseLayoutResult('[{"onScreenText":"just a string"}]')).toThrow(LayoutParseError);
  });

  test("an empty array is a failed pass, not a reading of zero beats", () => {
    expect(() => parseLayoutResult("[]")).toThrow(LayoutParseError);
  });

  test("tolerates a stray bracket in chatter before the real JSON", () => {
    const withChatter = `The caption reads like a placeholder such as [name] in many shorts.\n\n${good}`;
    expect(parseLayoutResult(withChatter)[0].onScreenText.value).toBe("Claude");
  });

  test("skips a decoy JSON array that is not a VideoLayout and finds the real one after it", () => {
    const withDecoy = `[{"note":"draft, ignore this"}]\n${good}`;
    expect(parseLayoutResult(withDecoy)[0].onScreenText.value).toBe("Claude");
  });

  test("does not let a bracket inside a string value corrupt the match boundary", () => {
    const withBracketInString = JSON.stringify([
      beatRow({ toolDemo: { value: "an array like [1, 2]", fromFramesSec: [0] } }),
    ]);
    expect(parseLayoutResult(withBracketInString)[0].toolDemo.value).toBe("an array like [1, 2]");
  });
});
