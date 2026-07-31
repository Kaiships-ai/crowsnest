import { describe, expect, test } from "vitest";

import type { VideoLayoutField } from "@/server/llm/schemas";
import { fieldValue } from "./layout-section";

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
