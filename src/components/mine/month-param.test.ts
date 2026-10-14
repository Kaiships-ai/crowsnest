import { describe, expect, test } from "vitest";
import { mineRedirectTarget, validMonth } from "./month-param";

describe("validMonth", () => {
  test("accepts YYYY-MM with a real month only", () => {
    expect(validMonth("2026-08")).toBe("2026-08");
    for (const bad of ["2026-13", "junk", "<script>", undefined, ["2026-08"]]) expect(validMonth(bad)).toBeNull();
  });
});

describe("mineRedirectTarget (ACTION-16, SEC-07)", () => {
  test("carries only a valid month, always to the same-origin Calendar tab", () => {
    expect(mineRedirectTarget({})).toBe("/?tab=calendar");
    expect(mineRedirectTarget({ month: "2026-08" })).toBe("/?tab=calendar&month=2026-08");
    expect(mineRedirectTarget({ month: "junk" })).toBe("/?tab=calendar");
    expect(mineRedirectTarget({ month: "2026-08", reel: "x", next: "https://evil.example" } as { month: string })).toBe("/?tab=calendar&month=2026-08");
  });
});
