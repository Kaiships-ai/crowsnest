import { describe, expect, test } from "vitest";

import { matchesQuery } from "./vault-filter";

describe("matchesQuery", () => {
  test("an empty or whitespace query matches every row", () => {
    expect(matchesQuery("", ["anything"])).toBe(true);
    expect(matchesQuery("   ", ["anything"])).toBe(true);
    expect(matchesQuery("", [null, undefined])).toBe(true);
  });

  test("matches case-insensitively across any field", () => {
    expect(matchesQuery("claude", ["Claude Code skills", null])).toBe(true);
    expect(matchesQuery("CLAUDE", ["claude code skills"])).toBe(true);
    expect(matchesQuery("kai", ["a caption", "@kaiships", "why kept"])).toBe(true);
  });

  test("every term has to land, in any field and any order", () => {
    const fields = ["Claude Code skills", "@kaiships", "worth remixing"];
    expect(matchesQuery("claude remixing", fields)).toBe(true);
    expect(matchesQuery("remixing claude", fields)).toBe(true);
    expect(matchesQuery("claude missing", fields)).toBe(false);
  });

  test("no match returns false", () => {
    expect(matchesQuery("gpt", ["Claude Code skills", "@kaiships"])).toBe(false);
  });

  test("null and undefined fields are skipped, not stringified", () => {
    expect(matchesQuery("null", ["a caption", null])).toBe(false);
    expect(matchesQuery("undefined", ["a caption", undefined])).toBe(false);
  });

  test("a term cannot match across two fields joined end to end", () => {
    expect(matchesQuery("cutaway", ["cut", "away"])).toBe(false);
  });
});
