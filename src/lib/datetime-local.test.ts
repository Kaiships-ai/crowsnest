import { describe, it, expect } from "vitest";
import { isoToLocalInput, localInputToIso } from "./datetime-local";

describe("datetime-local converters", () => {
  it("round-trips an iso timestamp through the local input shape", () => {
    const iso = "2026-07-31T09:30:00.000Z";
    const local = isoToLocalInput(iso);
    // datetime-local has no seconds/tz; the shape is YYYY-MM-DDTHH:mm
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // back to a valid iso instant
    expect(new Date(localInputToIso(local)).toString()).not.toBe("Invalid Date");
  });

  it("returns empty string for empty input, both directions", () => {
    expect(isoToLocalInput("")).toBe("");
    expect(localInputToIso("")).toBe("");
  });
});
