import { describe, expect, test } from "vitest";

import { asBeatLayout, type BeatLayout, type VideoLayoutField } from "@/server/llm/schemas";
import { fieldValue, framePassCta } from "./layout-section";

/**
 * `LayoutSection` itself uses `useRouter`/`useState` (client hooks with no Router
 * context in a node test run — the same reason `video-detail.tsx`'s `AnalysisGate` and
 * `carousel-viewer.tsx` have no render tests in this repo either), so only the pure
 * anti-fabrication rule is unit tested here: a value with no supporting frames is never
 * a reading, per schema.ts's `VideoLayoutField` doc comment.
 */
describe("fieldValue", () => {
  test("undefined field (layout column itself is null) is a dash", () => {
    expect(fieldValue(undefined)).toBeNull();
  });

  test("a value with fromFramesSec.length === 0 is not a reading, even if value is set", () => {
    const field: VideoLayoutField = { value: "centered caption", fromFramesSec: [] };
    expect(fieldValue(field)).toBeNull();
  });

  test("value: null is always a dash regardless of fromFramesSec", () => {
    const field: VideoLayoutField = { value: null, fromFramesSec: [1.2, 3.4] };
    expect(fieldValue(field)).toBeNull();
  });

  test("a value backed by at least one sampled frame is a real reading", () => {
    const field: VideoLayoutField = { value: "bottom third", fromFramesSec: [1.2] };
    expect(fieldValue(field)).toBe("bottom third");
  });
});

/**
 * The button decision is pulled out of the component for the same reason `fieldValue`
 * is: it is the part worth pinning down, and it can be checked without a router.
 */
describe("framePassCta", () => {
  test("offers Download when the last failure was a missing file", () => {
    expect(framePassCta({ hasLayout: false, lastCode: "FRAME_NO_VIDEO_ASSET" })).toEqual({
      label: "Download video",
      kind: "download",
    });
  });

  test("offers Re-run when a reading already exists", () => {
    expect(framePassCta({ hasLayout: true, lastCode: null })).toEqual({
      label: "Re-run frame pass",
      kind: "run",
    });
  });

  test("offers Run for a never-run video", () => {
    expect(framePassCta({ hasLayout: false, lastCode: null })).toEqual({
      label: "Run frame pass",
      kind: "run",
    });
  });

  test("a non-file failure still offers a plain run, not download", () => {
    expect(framePassCta({ hasLayout: false, lastCode: "FRAME_MODEL_FAILED" })).toEqual({
      label: "Run frame pass",
      kind: "run",
    });
  });
});

/**
 * The per-beat reshape left one old shape in the database: the flat whole-video layout.
 * It has no beat timecodes, so it cannot be shown in a per-beat table, and translating it
 * into beat rows would be inventing a mapping it never described. `asBeatLayout` is the
 * single place that decision is made, so it is the place worth pinning down.
 */
describe("asBeatLayout", () => {
  const beat: BeatLayout = {
    startSec: 0,
    endSec: 3,
    label: "Hook",
    onScreenText: { value: "3 MISTAKES", fromFramesSec: [0.5] },
    animation: { value: null, fromFramesSec: [] },
    demoCursor: { value: null, fromFramesSec: [] },
    toolDemo: { value: null, fromFramesSec: [] },
    textPosition: { value: null, fromFramesSec: [] },
    voicePace: { value: null, fromFramesSec: [] },
  };

  test("returns the rows for a per-beat layout", () => {
    expect(asBeatLayout([beat])).toEqual([beat]);
  });

  test("returns null for a flat layout written before the reshape, so it renders as re-run rather than as beats", () => {
    const flat = {
      onScreenText: { value: "3 MISTAKES", fromFramesSec: [0.5] },
      textPosition: { value: "upper third", fromFramesSec: [0.5] },
      cutRhythm: { value: "fast", fromFramesSec: [1] },
      framing: { value: "close-up", fromFramesSec: [0] },
    };
    expect(asBeatLayout(flat)).toBeNull();
  });

  test("returns null when no pass has run at all", () => {
    expect(asBeatLayout(null)).toBeNull();
    expect(asBeatLayout(undefined)).toBeNull();
  });
});

describe("fieldValue on a beat row", () => {
  test("still refuses a value that names no source frames, now per beat", () => {
    const unbacked: VideoLayoutField = { value: "Figma", fromFramesSec: [] };
    expect(fieldValue(unbacked)).toBeNull();
  });
});
