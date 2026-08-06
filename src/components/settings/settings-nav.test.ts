import { describe, expect, test } from "vitest";

import { activeSectionId } from "./settings-nav";

const ORDER = ["niche-profile", "instagram", "graph-api", "api-keys", "scoring"];

function pick(visible: string[], previous = ORDER[0]): string {
  return activeSectionId(ORDER, new Set(visible), previous);
}

describe("activeSectionId", () => {
  test("one section in the band is the active one", () => {
    expect(pick(["graph-api"])).toBe("graph-api");
  });

  test("two sections in the band resolve to the lower one", () => {
    // The lower section's top edge is what just crossed the reading line, and it's
    // the one filling the viewport below it — the same answer the old observer gave
    // while scrolling down, now given in both directions.
    expect(pick(["instagram", "graph-api"])).toBe("graph-api");
  });

  test("the answer does not depend on the order the observer reported them in", () => {
    // The regression this guards: the old code took the last *entry* in the callback
    // batch, so scrolling up past a boundary reported the outgoing section last and
    // marked it active. Same two sections in the band must give the same answer
    // whichever way the user arrived.
    expect(pick(["instagram", "graph-api"])).toBe(pick(["graph-api", "instagram"]));
  });

  test("keeps the previous section when nothing is in the band", () => {
    // Between two short sections the band can be empty for a frame; dropping the
    // highlight entirely reads as a flicker, so the last answer stands.
    expect(pick([], "scoring")).toBe("scoring");
  });

  test("ignores ids that are not sections on this page", () => {
    expect(pick(["not-a-section"], "instagram")).toBe("instagram");
  });

  test("never returns more than one section for a given set", () => {
    // Exactly one active section is the whole point (spec M4-U4): every subset of
    // the page's sections maps to a single id, and that id is always one of them.
    for (const visible of [["niche-profile", "instagram"], ["instagram", "graph-api", "api-keys"], ORDER]) {
      const result = pick(visible);
      expect(visible).toContain(result);
    }
  });
});
