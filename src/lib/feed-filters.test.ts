import { describe, expect, test } from "vitest";

import { bandOrAny, currentViewCriteria, isFeedEmpty, numOrAny, resolveChipValue, resolveFeedCriteria } from "./feed-filters";

const BALANCED_CRITERIA = { minScore: 5, sinceDays: 30 };

describe("resolveFeedCriteria", () => {
  test("bare {} resolves to Balanced (minScore 5, sinceDays 30)", () => {
    const result = resolveFeedCriteria({}, BALANCED_CRITERIA);
    expect(result.isEmpty).toBe(true);
    expect(result.minScore).toBe(5);
    expect(result.sinceDays).toBe(30);
  });

  test("a cosmetic-only param ({ density: 'compact' }) still resolves to Balanced (finding 1)", () => {
    const result = resolveFeedCriteria({ density: "compact" }, BALANCED_CRITERIA);
    expect(result.isEmpty).toBe(true);
    expect(result.minScore).toBe(5);
    expect(result.sinceDays).toBe(30);
  });

  test("other cosmetic params (view, sort, limit) also still resolve to Balanced", () => {
    for (const sp of [{ view: "list" }, { sort: "recent" }, { limit: "48" }]) {
      const result = resolveFeedCriteria(sp, BALANCED_CRITERIA);
      expect(result.isEmpty).toBe(true);
      expect(result.minScore).toBe(5);
      expect(result.sinceDays).toBe(30);
    }
  });

  test("{ minScore: 'any' } resolves to minScore undefined, and isEmpty false (finding 2)", () => {
    const result = resolveFeedCriteria({ minScore: "any" }, BALANCED_CRITERIA);
    expect(result.isEmpty).toBe(false);
    expect(result.minScore).toBeUndefined();
    // Balanced must not reapply once any filter param is present, even though this
    // particular one resolved to "no condition".
    expect(result.sinceDays).toBeUndefined();
  });

  test("{ minScore: '2' } resolves to minScore 2, Balanced not applied", () => {
    const result = resolveFeedCriteria({ minScore: "2" }, BALANCED_CRITERIA);
    expect(result.isEmpty).toBe(false);
    expect(result.minScore).toBe(2);
    expect(result.sinceDays).toBeUndefined();
  });

  test("{ since: 'any' } resolves to sinceDays undefined and isEmpty false", () => {
    const result = resolveFeedCriteria({ since: "any" }, BALANCED_CRITERIA);
    expect(result.isEmpty).toBe(false);
    expect(result.sinceDays).toBeUndefined();
  });

  test("no Balanced preset yet (undefined criteria) leaves everything undefined on a bare visit", () => {
    const result = resolveFeedCriteria({}, undefined);
    expect(result.isEmpty).toBe(true);
    expect(result.minScore).toBeUndefined();
    expect(result.sinceDays).toBeUndefined();
  });
});

describe("isFeedEmpty", () => {
  test("true for {}", () => {
    expect(isFeedEmpty({})).toBe(true);
  });

  test("true when only non-filter params are present", () => {
    expect(isFeedEmpty({ density: "compact", view: "list", sort: "recent", limit: "48" })).toBe(true);
  });

  test("false when a filter param is present, even if its value is 'any'", () => {
    expect(isFeedEmpty({ minScore: "any" })).toBe(false);
  });

  test("false when a real filter param is present", () => {
    expect(isFeedEmpty({ q: "cats" })).toBe(false);
  });

  test("true when a filter param is present but empty string (M6, /feed?minScore=)", () => {
    expect(isFeedEmpty({ minScore: "" })).toBe(true);
    expect(isFeedEmpty({ q: "" })).toBe(true);
  });
});

describe("numOrAny", () => {
  test("'any' resolves to undefined", () => {
    expect(numOrAny("any")).toBeUndefined();
  });

  test("a numeric string resolves to its number", () => {
    expect(numOrAny("2")).toBe(2);
  });

  test("undefined resolves to undefined", () => {
    expect(numOrAny(undefined)).toBeUndefined();
  });

  test("an array value reads its first element", () => {
    expect(numOrAny(["5", "10"])).toBe(5);
  });
});

describe("bandOrAny", () => {
  test("'any' resolves to undefined (C1)", () => {
    expect(bandOrAny("any")).toBeUndefined();
  });

  test("an unknown token resolves to undefined rather than throwing (C1)", () => {
    expect(bandOrAny("nope")).toBeUndefined();
  });

  test("undefined resolves to undefined", () => {
    expect(bandOrAny(undefined)).toBeUndefined();
  });

  test("each real band round-trips", () => {
    expect(bandOrAny("nano")).toBe("nano");
    expect(bandOrAny("micro")).toBe("micro");
    expect(bandOrAny("mid")).toBe("mid");
    expect(bandOrAny("macro")).toBe("macro");
  });

  test("an array value reads its first element", () => {
    expect(bandOrAny(["micro", "macro"])).toBe("micro");
  });
});

describe("resolveFeedCriteria with band", () => {
  test("{ band: 'any' } resolves followerBand-equivalent (numOrAny parity) and does not crash buildWhere's caller", () => {
    // resolveFeedCriteria itself doesn't touch band (that's page.tsx's job via
    // bandOrAny), but isFeedEmpty must still see `band` as a real filter param so
    // Balanced doesn't reapply once the user has picked a band, "any" included.
    expect(isFeedEmpty({ band: "any" })).toBe(false);
    expect(isFeedEmpty({ band: "nope" })).toBe(false);
  });
});

describe("resolveChipValue", () => {
  test("URL value wins when present", () => {
    expect(resolveChipValue("30", null)).toBe("30");
    expect(resolveChipValue("any", 5)).toBe("any");
  });

  test("falls back to the applied value when the URL has none", () => {
    expect(resolveChipValue(null, 30)).toBe("30");
  });

  test("falls back to 'any' when the URL has none and nothing was applied (finding 3)", () => {
    expect(resolveChipValue(null, null)).toBe("any");
  });
});

describe("currentViewCriteria", () => {
  test("omits keys resolved to 'any'", () => {
    expect(currentViewCriteria("any", "any", "any")).toEqual({});
  });

  test("includes only the keys with a real value, as numbers", () => {
    expect(currentViewCriteria("5", "any", "30")).toEqual({ minScore: 5, sinceDays: 30 });
  });

  test("never lets 'any' reach Number() and produce NaN in the criteria blob", () => {
    const result = currentViewCriteria("any", "any", "any");
    expect(Object.values(result).some((v) => typeof v === "number" && Number.isNaN(v))).toBe(false);
  });
});
