import { describe, expect, test } from "vitest";

import { vaultHeaderCopy } from "./vault-header-copy";

describe("vaultHeaderCopy", () => {
  test("all categories empty yields the whole-vault-empty copy", () => {
    expect(vaultHeaderCopy({ savedPosts: 0, scripts: 0, hooks: 0, styles: 0 })).toBe("Nothing saved yet.");
  });

  test("saved posts empty but another category has content yields the plain count line, not the empty-vault copy", () => {
    expect(vaultHeaderCopy({ savedPosts: 0, scripts: 1, hooks: 0, styles: 0 })).toBe("0 saved posts");
    expect(vaultHeaderCopy({ savedPosts: 0, scripts: 0, hooks: 3, styles: 0 })).toBe("0 saved posts");
    expect(vaultHeaderCopy({ savedPosts: 0, scripts: 0, hooks: 0, styles: 3 })).toBe("0 saved posts");
  });

  test("singular vs plural saved-post count wording", () => {
    expect(vaultHeaderCopy({ savedPosts: 1, scripts: 0, hooks: 0, styles: 0 })).toBe("1 saved post");
    expect(vaultHeaderCopy({ savedPosts: 2, scripts: 0, hooks: 0, styles: 0 })).toBe("2 saved posts");
  });
});
