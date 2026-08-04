import { describe, expect, test } from "vitest";
import { buildLayoutPrompt, parseLayoutResult, LayoutParseError } from "./frame-pass-prompt";
import type { SampledFrame } from "./watch-frames";

const FRAMES: SampledFrame[] = [
  { path: "/tmp/f/frame_0001.jpg", timestampSeconds: 0, reason: "first-frame" },
  { path: "/tmp/f/frame_0002.jpg", timestampSeconds: 3, reason: "scene-change" },
];

describe("buildLayoutPrompt", () => {
  test("names every frame path with its timestamp", () => {
    const p = buildLayoutPrompt(FRAMES);
    expect(p).toContain("/tmp/f/frame_0001.jpg");
    expect(p).toContain("/tmp/f/frame_0002.jpg");
    expect(p).toContain("t=0s");
    expect(p).toContain("t=3s");
  });

  test("asks for a short citation, which is what stops the output truncating", () => {
    expect(buildLayoutPrompt(FRAMES)).toContain("2 to 5");
  });
});

describe("parseLayoutResult", () => {
  const good = JSON.stringify({
    onScreenText: { value: "Claude", fromFramesSec: [3, 0, 3] },
    textPosition: { value: null, fromFramesSec: [] },
    cutRhythm: { value: "hard cut every 2s", fromFramesSec: [0, 3] },
    framing: { value: "close-up talking head", fromFramesSec: [0] },
  });

  test("parses a bare JSON object", () => {
    expect(parseLayoutResult(good).onScreenText.value).toBe("Claude");
  });

  test("parses JSON wrapped in a markdown fence", () => {
    expect(parseLayoutResult("```json\n" + good + "\n```").framing.value).toBe("close-up talking head");
  });

  test("dedupes and sorts fromFramesSec", () => {
    expect(parseLayoutResult(good).onScreenText.fromFramesSec).toEqual([0, 3]);
  });

  test("keeps a genuine null field as null", () => {
    const out = parseLayoutResult(good);
    expect(out.textPosition.value).toBeNull();
    expect(out.textPosition.fromFramesSec).toEqual([]);
  });

  test("throws on JSON with no closing brace at all", () => {
    expect(() => parseLayoutResult('{"onScreenText":{"value":"x","fromFramesSec":[0,1,2')).toThrow(LayoutParseError);
  });

  test("throws on a realistically truncated payload where inner objects closed but the outer one did not", () => {
    const truncated =
      '{"onScreenText":{"value":"x","fromFramesSec":[0,1,2]},"textPosition":{"value":null,"fromFramesSec":[]}';
    expect(() => parseLayoutResult(truncated)).toThrow(LayoutParseError);
  });

  test("throws when the shape is not a VideoLayout", () => {
    expect(() => parseLayoutResult('{"onScreenText":"just a string"}')).toThrow(LayoutParseError);
  });

  test("tolerates a stray brace in chatter before the real JSON", () => {
    const withChatter = `The caption style resembles a template like {caption} used in many shorts.\n\n${good}`;
    expect(parseLayoutResult(withChatter).onScreenText.value).toBe("Claude");
  });

  test("skips a decoy JSON object that is not a VideoLayout and finds the real one after it", () => {
    const withDecoy = `{"note":"draft, ignore this"}\n${good}`;
    expect(parseLayoutResult(withDecoy).onScreenText.value).toBe("Claude");
  });

  test("does not let a brace inside a string value corrupt the match boundary", () => {
    const withBraceInString = JSON.stringify({
      onScreenText: { value: "Claude", fromFramesSec: [0] },
      textPosition: { value: null, fromFramesSec: [] },
      cutRhythm: { value: "hard cut every 2s", fromFramesSec: [0] },
      framing: { value: "use {curly} braces", fromFramesSec: [0] },
    });
    expect(parseLayoutResult(withBraceInString).framing.value).toBe("use {curly} braces");
  });
});
