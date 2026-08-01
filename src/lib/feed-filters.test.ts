import { describe, expect, test } from "vitest";

import { isFeedEmpty, numOrAny, resolveFeedCriteria } from "./feed-filters";

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
