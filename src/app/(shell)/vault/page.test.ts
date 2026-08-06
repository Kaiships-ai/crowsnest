import { describe, expect, test } from "vitest";

import { vaultHeaderCopy } from "./vault-header-copy";

describe("vaultHeaderCopy", () => {
  test("all categories empty yields the whole-vault-empty copy", () => {
    expect(vaultHeaderCopy({ savedPosts: 0, scripts: 0, hooks: 0, styles: 0 })).toBe("Nothing saved yet.");
  });

  test("counts every category that has content, never a zero one", () => {
    expect(vaultHeaderCopy({ savedPosts: 12, scripts: 3, hooks: 2, styles: 1 })).toBe(
      "12 saved posts · 3 scripts · 2 hooks · 1 style"
    );
  });

  test("no saved posts but scripts present reads about the scripts, not '0 saved posts'", () => {
    expect(vaultHeaderCopy({ savedPosts: 0, scripts: 2, hooks: 0, styles: 0 })).toBe("2 scripts");
    expect(vaultHeaderCopy({ savedPosts: 0, scripts: 0, hooks: 3, styles: 0 })).toBe("3 hooks");
    expect(vaultHeaderCopy({ savedPosts: 0, scripts: 0, hooks: 0, styles: 3 })).toBe("3 styles");
  });

  test("singular vs plural wording per category", () => {
    expect(vaultHeaderCopy({ savedPosts: 1, scripts: 0, hooks: 0, styles: 0 })).toBe("1 saved post");
    expect(vaultHeaderCopy({ savedPosts: 2, scripts: 1, hooks: 1, styles: 0 })).toBe("2 saved posts · 1 script · 1 hook");
  });

  test("a search reports how many rows it left, across every tab", () => {
    expect(vaultHeaderCopy({ savedPosts: 3, scripts: 1, hooks: 0, styles: 0 }, "claude")).toBe(
      '4 matches for "claude"'
    );
    expect(vaultHeaderCopy({ savedPosts: 1, scripts: 0, hooks: 0, styles: 0 }, "claude")).toBe(
      '1 match for "claude"'
    );
  });

  test("a search that found nothing says so instead of claiming the vault is empty", () => {
    expect(vaultHeaderCopy({ savedPosts: 0, scripts: 0, hooks: 0, styles: 0 }, "gpt")).toBe('No matches for "gpt"');
  });
});
