import { describe, expect, test } from "vitest";

import { looksLikeInstagramUrl, normalizeHandle } from "./handle";

describe("normalizeHandle", () => {
  test("accepts bare, @-prefixed and URL forms", () => {
    expect(normalizeHandle("kallaway")).toBe("@kallaway");
    expect(normalizeHandle("@kallaway")).toBe("@kallaway");
    expect(normalizeHandle("https://www.instagram.com/hormozi/")).toBe("@hormozi");
  });

  test("rejects junk", () => {
    expect(() => normalizeHandle("has spaces")).toThrow();
  });
});

// BEH-01: a pasted profile URL is a typo in the add-channel dialog's "By handle" field,
// not a handle to silently extract. See handle.ts's doc comment on why the extraction
// itself stays put in normalizeHandle.
describe("looksLikeInstagramUrl", () => {
  test("flags a pasted profile URL", () => {
    expect(looksLikeInstagramUrl("https://www.instagram.com/creator/")).toBe(true);
    expect(looksLikeInstagramUrl("instagram.com/hormozi")).toBe(true);
    expect(looksLikeInstagramUrl("  https://www.instagram.com/hormozi/  ")).toBe(true);
  });

  test("does not flag a bare handle", () => {
    expect(looksLikeInstagramUrl("hormozi")).toBe(false);
    expect(looksLikeInstagramUrl("@hormozi")).toBe(false);
    expect(looksLikeInstagramUrl("")).toBe(false);
  });
});
