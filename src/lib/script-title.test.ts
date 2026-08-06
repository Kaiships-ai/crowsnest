import { describe, expect, test } from "vitest";

import { deriveScriptTitle, SCRIPT_TITLE_MAX } from "./script-title";

describe("deriveScriptTitle", () => {
  test("no source text falls back to the placeholder", () => {
    expect(deriveScriptTitle(null)).toBe("Untitled script");
    expect(deriveScriptTitle("")).toBe("Untitled script");
    expect(deriveScriptTitle("   \n  ")).toBe("Untitled script");
  });

  test("a title that is already short comes back untouched", () => {
    expect(deriveScriptTitle("AI Tool Nobody's Talking About")).toBe("AI Tool Nobody's Talking About");
  });

  test("cuts at the first sentence, which drops the prompt stage's niche suffix", () => {
    expect(deriveScriptTitle("Comment 'DIE' and I'll send it over. — for my niche")).toBe(
      "Comment 'DIE' and I'll send it over"
    );
  });

  test("a whole caption body becomes one short line", () => {
    const caption =
      'Comment "DESIGN" to get these 4 Claude Code Skills for better designs.\n\nClaude Code is great at coding but terrible at front end design.\n\nSo I built four skills that fix it. #claude #design #ai';
    const title = deriveScriptTitle(caption);
    expect(title.length).toBeLessThanOrEqual(SCRIPT_TITLE_MAX + 1);
    expect(title).not.toContain("\n");
    expect(title.startsWith('Comment "DESIGN" to get these 4 Claude Code Skills')).toBe(true);
  });

  test("truncation lands on a word boundary and is marked", () => {
    const title = deriveScriptTitle("a".repeat(20) + " " + "b".repeat(80));
    expect(title).toBe("a".repeat(20) + "…");
  });

  test("collapses runs of whitespace", () => {
    expect(deriveScriptTitle("Two   words\tapart")).toBe("Two words apart");
  });

  test("strips hashtags, which carry no meaning in a title", () => {
    expect(deriveScriptTitle("The tool everyone is sleeping on #ai #tools")).toBe("The tool everyone is sleeping on");
  });

  test("a sentence cut that leaves almost nothing is ignored in favour of the fuller line", () => {
    expect(deriveScriptTitle("3. Clone a voice in 83 languages")).toBe("3. Clone a voice in 83 languages");
  });

  test("text with no letters left after stripping falls back to the placeholder", () => {
    expect(deriveScriptTitle("#ai #tools")).toBe("Untitled script");
  });
});
